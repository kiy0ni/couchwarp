//! The X11 side of the Linux host: which windows exist, which one is in front, and what
//! they show. On a Wayland desktop this is XWayland, where most games run (Steam, Proton,
//! Wine, SDL games by default). Windows drawn natively for Wayland cannot be read by
//! another program and are not listed.

use std::sync::{Mutex, OnceLock};

use anyhow::{Context, Result};
use x11rb::connection::Connection;
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
        Ok(Self {
            connection,
            root,
            atoms,
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
