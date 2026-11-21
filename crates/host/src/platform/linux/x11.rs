//! The X11 side of the Linux host: which windows exist, which one is in front, and what
//! they show. On a Wayland desktop this is XWayland, where most games run (Steam, Proton,
//! Wine, SDL games by default). Windows drawn natively for Wayland cannot be read by
//! another program and are not listed.

use std::fs::File;
use std::os::unix::fs::FileExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use anyhow::{Context, Result};
use x11rb::connection::Connection;
use x11rb::protocol::shm::{self, ConnectionExt as _};
use x11rb::protocol::xfixes::ConnectionExt as _;
use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt as _, ImageFormat, MapState, Window};
use x11rb::rust_connection::RustConnection;

struct Atoms {
    client_list: Atom,
    active_window: Atom,
    wm_pid: Atom,
    wm_name: Atom,
    utf8_string: Atom,
}

/// One connection to the X server.
pub struct Display {
    connection: RustConnection,
    root: Window,
    atoms: Atoms,
    /// The server can tell where the pointer is and what it looks like.
    xfixes: bool,
    /// Pictures come through memory shared with the server, while that works.
    shm_works: AtomicBool,
    shared: Mutex<Option<SharedMemory>>,
}

/// A file in memory the X server writes pictures into.
struct SharedMemory {
    file: File,
    segment: shm::Seg,
    capacity: usize,
}

/// A window's pixels: BGRA rows with no padding, width, height.
pub type Pixels = (Vec<u8>, usize, usize);

impl Display {
    pub fn open() -> Result<Self> {
        let (connection, screen) = x11rb::connect(None).context(
            "no X11 display: Couchwarp shares X11 and XWayland windows, and DISPLAY is not set",
        )?;
        let root = connection
            .setup()
            .roots
            .get(screen)
            .context("the X11 display has no screen")?
            .root;
        let atom = |name: &[u8]| -> Result<Atom> {
            Ok(connection.intern_atom(false, name)?.reply()?.atom)
        };
        let atoms = Atoms {
            client_list: atom(b"_NET_CLIENT_LIST")?,
            active_window: atom(b"_NET_ACTIVE_WINDOW")?,
            wm_pid: atom(b"_NET_WM_PID")?,
            wm_name: atom(b"_NET_WM_NAME")?,
            utf8_string: atom(b"UTF8_STRING")?,
        };
        let xfixes = connection
            .xfixes_query_version(5, 0)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .is_some();
        // Passing a file to the server needs MIT-SHM 1.2.
        let shm_works = connection
            .shm_query_version()
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .is_some_and(|version| (version.major_version, version.minor_version) >= (1, 2));
        Ok(Self {
            connection,
            root,
            atoms,
            xfixes,
            shm_works: AtomicBool::new(shm_works),
            shared: Mutex::new(None),
        })
    }

    /// The windows the window manager lists, or the top-level ones when there is none.
    pub fn windows(&self) -> Vec<Window> {
        let listed = self.numbers(self.root, self.atoms.client_list, AtomEnum::WINDOW.into());
        if !listed.is_empty() {
            return listed;
        }
        self.connection
            .query_tree(self.root)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|tree| tree.children)
            .unwrap_or_default()
    }

    /// The process that drew the window, as the program declared it.
    pub fn pid(&self, window: Window) -> Option<i32> {
        let pids = self.numbers(window, self.atoms.wm_pid, AtomEnum::CARDINAL.into());
        pids.first().and_then(|&pid| i32::try_from(pid).ok())
    }

    pub fn title(&self, window: Window) -> Option<String> {
        let utf8 = self.text(window, self.atoms.wm_name, self.atoms.utf8_string);
        let bytes =
            utf8.or_else(|| self.text(window, AtomEnum::WM_NAME.into(), AtomEnum::STRING.into()))?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The window's size, if it is on screen.
    pub fn visible_size(&self, window: Window) -> Option<(u32, u32)> {
        let attributes = self
            .connection
            .get_window_attributes(window)
            .ok()?
            .reply()
            .ok()?;
        if attributes.map_state != MapState::VIEWABLE {
            return None;
        }
        let geometry = self.connection.get_geometry(window).ok()?.reply().ok()?;
        Some((u32::from(geometry.width), u32::from(geometry.height)))
    }

    /// What the window shows now, or None while it is not on screen (minimised, or on
    /// another workspace). An error means the window is gone.
    pub fn pixels(&self, window: Window) -> Result<Option<Pixels>> {
        let geometry = self
            .connection
            .get_geometry(window)?
            .reply()
            .context("the window was closed")?;
        let (width, height) = (usize::from(geometry.width), usize::from(geometry.height));
        if self.shm_works.load(Ordering::Relaxed) {
            match self.shared_pixels(window, (geometry.width, geometry.height)) {
                Ok(pixels) => return Ok(pixels),
                Err(error) => {
                    tracing::info!("{error:#}; reading pictures without shared memory");
                    self.shm_works.store(false, Ordering::Relaxed);
                }
            }
        }
        let image = self.connection.get_image(
            ImageFormat::Z_PIXMAP,
            window,
            0,
            0,
            geometry.width,
            geometry.height,
            u32::MAX,
        )?;
        let Ok(image) = image.reply() else {
            return Ok(None);
        };
        // 24 and 32 bit displays store four bytes a pixel, blue first; nothing else is read.
        if image.data.len() != width * height * 4 {
            return Ok(None);
        }
        Ok(Some((image.data, width, height)))
    }

    /// The window's pixels through shared memory: the server writes them into a file in
    /// memory, read here without crossing the connection.
    fn shared_pixels(&self, window: Window, size: (u16, u16)) -> Result<Option<Pixels>> {
        let (width, height) = (usize::from(size.0), usize::from(size.1));
        let length = width * height * 4;
        let mut shared = self.shared.lock().expect("never poisoned");
        if shared
            .as_ref()
            .is_none_or(|memory| memory.capacity < length)
        {
            if let Some(old) = shared.take() {
                let _ = self.connection.shm_detach(old.segment);
            }
            *shared = Some(self.share_memory(length)?);
        }
        let memory = shared.as_ref().expect("set above");
        let reply = self
            .connection
            .shm_get_image(
                window,
                0,
                0,
                size.0,
                size.1,
                u32::MAX,
                ImageFormat::Z_PIXMAP.into(),
                memory.segment,
                0,
            )?
            .reply();
        // Not on screen (minimised, or on another workspace).
        let Ok(reply) = reply else {
            return Ok(None);
        };
        // 24 and 32 bit displays store four bytes a pixel, blue first; nothing else is read.
        if reply.size as usize != length {
            return Ok(None);
        }
        let mut pixels = vec![0; length];
        memory.file.read_exact_at(&mut pixels, 0)?;
        Ok(Some((pixels, width, height)))
    }

    fn share_memory(&self, capacity: usize) -> Result<SharedMemory> {
        let path = format!(
            "/dev/shm/couchwarp-{}-{}",
            std::process::id(),
            fastrand::u32(..)
        );
        let file = File::options()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
            .context("shared memory")?;
        // The open files keep it; nothing is left behind if the host stops.
        std::fs::remove_file(&path)?;
        file.set_len(capacity as u64)?;
        let segment = self.connection.generate_id()?;
        self.connection
            .shm_attach_fd(segment, file.try_clone()?, false)?
            .check()
            .context("the X server did not take the shared memory")?;
        Ok(SharedMemory {
            file,
            segment,
            capacity,
        })
    }

    /// Draws the pointer into a picture of `window`, where it is over it.
    pub fn draw_cursor(&self, window: Window, pixels: &mut [u8], width: usize, height: usize) {
        if !self.xfixes {
            return;
        }
        let origin = self
            .connection
            .translate_coordinates(window, self.root, 0, 0)
            .ok()
            .and_then(|cookie| cookie.reply().ok());
        let cursor = self
            .connection
            .xfixes_get_cursor_image()
            .ok()
            .and_then(|cookie| cookie.reply().ok());
        let (Some(origin), Some(cursor)) = (origin, cursor) else {
            return;
        };
        let left = i32::from(cursor.x) - i32::from(cursor.xhot) - i32::from(origin.dst_x);
        let top = i32::from(cursor.y) - i32::from(cursor.yhot) - i32::from(origin.dst_y);
        crate::cursor::blend(
            pixels,
            (width, height),
            &cursor.cursor_image,
            (usize::from(cursor.width), usize::from(cursor.height)),
            left,
            top,
        );
    }

    fn numbers(&self, window: Window, property: Atom, kind: Atom) -> Vec<u32> {
        self.connection
            .get_property(false, window, property, kind, 0, 4096)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .and_then(|reply| reply.value32().map(Iterator::collect))
            .unwrap_or_default()
    }

    fn text(&self, window: Window, property: Atom, kind: Atom) -> Option<Vec<u8>> {
        let reply = self
            .connection
            .get_property(false, window, property, kind, 0, 1024)
            .ok()?
            .reply()
            .ok()?;
        (!reply.value.is_empty()).then_some(reply.value)
    }
}

/// The process of the window in front. Asked many times a second by the focus lock, so
/// one connection is kept for it.
pub fn active_window_pid() -> Option<i32> {
    static DISPLAY: OnceLock<Option<Mutex<Display>>> = OnceLock::new();
    let display = DISPLAY
        .get_or_init(|| Display::open().ok().map(Mutex::new))
        .as_ref()?
        .lock()
        .ok()?;
    let active = *display
        .numbers(
            display.root,
            display.atoms.active_window,
            AtomEnum::WINDOW.into(),
        )
        .first()?;
    display.pid(active)
}
