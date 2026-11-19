//! Captures one window with Windows Graphics Capture and feeds every new frame to the
//! encoder. Only the window is shared, without the yellow capture border.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use tokio::sync::mpsc;
use windows_capture::capture::{
    CaptureControl, Context as CaptureContext, GraphicsCaptureApiHandler,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use super::encoder::Encoder;
use super::sound::SoundCapture;
use crate::audio::AudioPacket;
use crate::thumbnail::Thumbnails;

/// Windows smaller than this are palettes, tooltips and the like, never a game.
const MIN_WINDOW_SIDE: i32 = 200;

type CaptureError = Box<dyn std::error::Error + Send + Sync>;

pub struct GameWindow {
    window: Window,
    pub title: String,
    pub app: String,
    pub pid: i32,
    width: i32,
    height: i32,
}

impl GameWindow {
    /// The window's own pixel size. The software encoder follows the window, so the
    /// maximum height only applies to hosts with a scaling capture (macOS for now).
    pub fn stream_size(&self, _max_height: u32) -> (u32, u32) {
        ((self.width as u32) & !1, (self.height as u32) & !1)
    }
}

pub fn list_windows() -> Result<Vec<GameWindow>> {
    let windows = Window::enumerate().map_err(|error| anyhow!("cannot list windows: {error}"))?;
    Ok(windows
        .into_iter()
        .filter_map(|window| {
            let title = window.title().ok().filter(|title| !title.is_empty())?;
            let (width, height) = (window.width().ok()?, window.height().ok()?);
            let pid = window.process_id().ok()? as i32;
            (width >= MIN_WINDOW_SIDE && height >= MIN_WINDOW_SIDE).then(|| GameWindow {
                app: window.process_name().unwrap_or_default(),
                pid,
                title,
                width,
                height,
                window,
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
        .max_by_key(|w| i64::from(w.width) * i64::from(w.height))
        .with_context(|| format!("no window matches \"{query}\" (see --list-windows)"))
}

struct FrameHandler {
    encoder: Arc<Encoder>,
    thumbnails: Arc<Thumbnails>,
    stopped: mpsc::UnboundedSender<String>,
    scratch: Vec<u8>,
}

impl GraphicsCaptureApiHandler for FrameHandler {
    type Flags = (Arc<Encoder>, Arc<Thumbnails>, mpsc::UnboundedSender<String>);
    type Error = CaptureError;

    fn new(context: CaptureContext<Self::Flags>) -> Result<Self, Self::Error> {
        let (encoder, thumbnails, stopped) = context.flags;
        Ok(Self {
            encoder,
            thumbnails,
            stopped,
            scratch: Vec::new(),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        let captured_at = Instant::now();
        let (width, height) = (frame.width() as usize, frame.height() as usize);
        let buffer = frame.buffer()?;
        let pixels = buffer.as_nopadding_buffer(&mut self.scratch);
        self.encoder.encode_bgra(pixels, width, height, captured_at);
        if self.thumbnails.due() {
            self.thumbnails.send_bgra(pixels, width, height);
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        // The receiver is gone only when the host is already shutting down.
        let _ = self.stopped.send("the window was closed".to_owned());
        Ok(())
    }
}

pub struct Capture {
    control: Option<CaptureControl<FrameHandler, CaptureError>>,
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
        let settings = Settings::new(
            window.window,
            CursorCaptureSettings::WithCursor,
            DrawBorderSettings::WithoutBorder,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Custom(Duration::from_secs_f64(1.0 / f64::from(fps))),
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            (encoder, thumbnails, stopped),
        );
        let control = FrameHandler::start_free_threaded(settings)
            .map_err(|error| anyhow!("window capture failed: {error}"))?;
        Ok(Self {
            control: Some(control),
            _sound: SoundCapture::start(window.pid as u32, sound),
        })
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        if let Some(control) = self.control.take()
            && let Err(error) = control.stop()
        {
            tracing::warn!("capture did not stop cleanly: {error}");
        }
    }
}
