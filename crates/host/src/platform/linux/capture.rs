//! Captures one X11 window at the stream's frame rate and feeds each frame to the encoder,
//! with the game's sound alongside. Only the window is read, never the rest of the screen.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tokio::sync::mpsc;
use x11rb::protocol::xproto::Window;

use super::encoder::Encoder;
use super::sound::SoundCapture;
use super::x11::Display;
use crate::audio::AudioPacket;
use crate::thumbnail::{Thumbnails, picture_from_bgra};

/// Windows smaller than this are palettes, tooltips and the like, never a game.
const MIN_WINDOW_SIDE: u32 = 200;

pub struct GameWindow {
    window: Window,
    /// The X11 window id: stays the same while the window exists.
    pub id: u64,
    pub title: String,
    pub app: String,
    pub pid: i32,
    width: u32,
    height: u32,
}

impl GameWindow {
    /// The window's own pixel size; the software encoder follows it if it changes.
    pub fn stream_size(&self, _max_height: u32) -> (u32, u32) {
        (self.width & !1, self.height & !1)
    }

    /// A small JPEG of the window as it is now, to recognise it in a list.
    pub fn preview(&self) -> Result<Vec<u8>> {
        let (pixels, width, height) = Display::open()?
            .pixels(self.window)?
            .context("the window is not on screen (minimised?)")?;
        picture_from_bgra(&pixels, width, height)
    }
}

pub fn list_windows() -> Result<Vec<GameWindow>> {
    let display = Display::open()?;
    Ok(display
        .windows()
        .into_iter()
        .filter_map(|window| {
            let (width, height) = display.visible_size(window)?;
            if width < MIN_WINDOW_SIDE || height < MIN_WINDOW_SIDE {
                return None;
            }
            let title = display.title(window).filter(|title| !title.is_empty())?;
            let pid = display.pid(window).unwrap_or(0);
            Some(GameWindow {
                window,
                id: u64::from(window),
                app: process_name(pid),
                pid,
                title,
                width,
                height,
            })
        })
        .collect())
}

/// The largest window whose title or process name contains `query`, ignoring case.
pub fn find_window(query: &str) -> Result<GameWindow> {
    let query = query.to_lowercase();
    list_windows()?
        .into_iter()
        .filter(|w| {
            w.title.to_lowercase().contains(&query) || w.app.to_lowercase().contains(&query)
        })
        .max_by_key(|w| u64::from(w.width) * u64::from(w.height))
        .with_context(|| format!("no window matches \"{query}\" (see --list-windows)"))
}

fn process_name(pid: i32) -> String {
    std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .map(|name| name.trim().to_owned())
        .unwrap_or_default()
}

pub struct Capture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    _sound: SoundCapture,
}

impl Capture {
    /// Video goes to `encoder`, sound to `sound`. `stopped` receives the reason if capture
    /// ends on its own (the window closed).
    pub fn start(
        window: &GameWindow,
        _size: (u32, u32),
        fps: u32,
        encoder: Arc<Encoder>,
        thumbnails: Arc<Thumbnails>,
        sound: mpsc::Sender<AudioPacket>,
        stopped: mpsc::UnboundedSender<String>,
    ) -> Result<Self> {
        let display = Display::open()?;
        let target = window.window;
        let every = Duration::from_secs_f64(1.0 / f64::from(fps.max(1)));
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let thread = std::thread::Builder::new()
            .name("capture".to_owned())
            .spawn(move || {
                let mut next = Instant::now();
                while !stopping.load(Ordering::Acquire) {
                    let captured_at = Instant::now();
                    match display.pixels(target) {
                        Ok(Some((pixels, width, height))) => {
                            encoder.encode_bgra(&pixels, width, height, captured_at);
                            if thumbnails.due() {
                                thumbnails.send_bgra(&pixels, width, height);
                            }
                        }
                        // Minimised: nothing to send until it is back.
                        Ok(None) => {}
                        Err(_) => {
                            // The receiver is gone only when the host is already stopping.
                            let _ = stopped.send("the window was closed".to_owned());
                            return;
                        }
                    }
                    // Steady frame times; a slow frame is not made up by a burst.
                    next += every;
                    let now = Instant::now();
                    match next.checked_duration_since(now) {
                        Some(wait) => std::thread::sleep(wait),
                        None => next = now,
                    }
                }
            })?;
        Ok(Self {
            stop,
            thread: Some(thread),
            _sound: SoundCapture::start(window.pid, sound),
        })
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        AtomEnum, ConnectionExt as _, CreateWindowAux, PropMode, WindowClass,
    };
    use x11rb::wrapper::ConnectionExt as _;

    use super::*;

    /// Needs an X server: CI runs it under `xvfb-run`; elsewhere it passes without one.
    #[test]
    fn lists_a_window_and_reads_its_pixels() {
        if std::env::var_os("DISPLAY").is_none() {
            eprintln!("no DISPLAY: X11 capture not tested here");
            return;
        }
        let (connection, screen) = x11rb::connect(None).unwrap();
        let screen = &connection.setup().roots[screen];
        let window = connection.generate_id().unwrap();
        // Orange: red ff, green 80, blue 00.
        let aux = CreateWindowAux::new().background_pixel(0x00ff_8000);
        connection
            .create_window(
                screen.root_depth,
                window,
                screen.root,
                0,
                0,
                320,
                240,
                0,
                WindowClass::INPUT_OUTPUT,
                screen.root_visual,
                &aux,
            )
            .unwrap();
        connection
            .change_property8(
                PropMode::REPLACE,
                window,
                AtomEnum::WM_NAME,
                AtomEnum::STRING,
                b"Couchwarp capture test",
            )
            .unwrap();
        connection.map_window(window).unwrap();
        connection.sync().unwrap();
        std::thread::sleep(Duration::from_millis(200));

        let found = list_windows()
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.title == "Couchwarp capture test")
            .expect("the window is listed");
        assert_eq!(found.stream_size(u32::MAX), (320, 240));
        let (pixels, width, height) = Display::open()
            .unwrap()
            .pixels(found.window)
            .unwrap()
            .expect("the window is on screen");
        assert_eq!((width, height), (320, 240));
        assert_eq!(pixels[..3], [0x00, 0x80, 0xff]);
        assert!(!found.preview().unwrap().is_empty());
    }
}
