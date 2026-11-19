//! Captures one window with ScreenCaptureKit and feeds every new frame to the encoder.
//! Only the window is shared: notifications, the menu bar and other apps stay private.

use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use objc2_core_media::{CMTime, CMTimeFlags};
use objc2_core_video::CVImageBuffer;
use screencapturekit::SCFrameStatus;
use screencapturekit::prelude::*;
use screencapturekit::stream::configuration::PixelFormat;
use tokio::sync::mpsc;
use tracing::warn;

use super::encoder::Encoder;

/// Windows smaller than this are palettes, tooltips and the like, never a game.
const MIN_WINDOW_SIDE: f64 = 200.0;
/// Apple Silicon Macs draw two pixels per point.
const PIXELS_PER_POINT: f64 = 2.0;

pub struct GameWindow {
    window: SCWindow,
    pub title: String,
    pub app: String,
    pub pid: i32,
    width_points: f64,
    height_points: f64,
}

impl GameWindow {
    /// Pixel size for the stream: the window's own, at most `max_height` tall, even numbers
    /// (H.264 works on 2×2 blocks of colour).
    pub fn stream_size(&self, max_height: u32) -> (u32, u32) {
        let height = (self.height_points * PIXELS_PER_POINT).min(f64::from(max_height));
        let width = height * self.width_points / self.height_points;
        let even = |side: f64| (side as u32) & !1;
        (even(width), even(height))
    }
}

pub fn list_windows() -> Result<Vec<GameWindow>> {
    let content = SCShareableContent::get().map_err(|error| {
        anyhow!(
            "cannot list windows ({error}). Allow this terminal in System Settings > \
             Privacy & Security > Screen & System Audio Recording, then restart it"
        )
    })?;
    Ok(content
        .windows()
        .into_iter()
        .filter(|window| window.is_on_screen() && window.window_layer() == 0)
        .filter_map(|window| {
            let app = window.owning_application()?;
            let frame = window.frame();
            (frame.size.width >= MIN_WINDOW_SIDE && frame.size.height >= MIN_WINDOW_SIDE).then(
                || GameWindow {
                    title: window.title().unwrap_or_default(),
                    app: app.application_name(),
                    pid: app.process_id(),
                    width_points: frame.size.width,
                    height_points: frame.size.height,
                    window,
                },
            )
        })
        .collect())
}

/// The largest window whose title or application name contains `query`, ignoring case.
pub fn find_window(query: &str) -> Result<GameWindow> {
    let query = query.to_lowercase();
    list_windows()?
        .into_iter()
        .filter(|w| {
            w.title.to_lowercase().contains(&query) || w.app.to_lowercase().contains(&query)
        })
        .max_by(|a, b| {
            let area = |w: &GameWindow| w.width_points * w.height_points;
            area(a).total_cmp(&area(b))
        })
        .with_context(|| format!("no window matches \"{query}\" (see --list-windows)"))
}

pub struct Capture {
    stream: SCStream,
}

/// Reports why ScreenCaptureKit stopped, most often because the window closed.
struct StopReporter(mpsc::UnboundedSender<String>);

impl SCStreamDelegateTrait for StopReporter {
    fn did_stop_with_error(&self, error: SCError) {
        // The receiver is gone only when the host is already shutting down.
        let _ = self.0.send(error.to_string());
    }
}

impl Capture {
    /// `stopped` receives the reason if capture ends on its own (the window closed).
    pub fn start(
        window: &GameWindow,
        size: (u32, u32),
        fps: u32,
        encoder: Arc<Encoder>,
        stopped: mpsc::UnboundedSender<String>,
    ) -> Result<Self> {
        let filter = SCContentFilter::create()
            .with_window(&window.window)
            .build()?;
        let config = SCStreamConfiguration::new()
            .with_width(size.0)
            .with_height(size.1)
            .with_scales_to_fit(true)
            // NV12, what the hardware encoder takes without a conversion.
            .with_pixel_format(PixelFormat::YCbCr_420v)
            .with_minimum_frame_interval(&screencapturekit::cm::CMTime::new(1, fps as i32))
            // Few buffers in flight: a frame waiting in a queue is latency.
            .with_queue_depth(3)
            .with_shows_cursor(true);

        let mut stream = SCStream::new_with_delegate(&filter, &config, StopReporter(stopped))?;
        stream.add_output_handler(
            move |sample: CMSampleBuffer, kind: SCStreamOutputType| {
                if kind != SCStreamOutputType::Screen
                    || sample.frame_status() != Some(SCFrameStatus::Complete)
                {
                    return;
                }
                let image = sample.image_buffer_ptr_borrowed();
                if image.is_null() {
                    return;
                }
                let time = sample.presentation_timestamp();
                let presented_at = CMTime {
                    value: time.value,
                    timescale: time.timescale,
                    flags: CMTimeFlags(time.flags),
                    epoch: time.epoch,
                };
                // SAFETY: a complete frame carries a valid pixel buffer, alive while `sample` is.
                encoder.encode(unsafe { &*image.cast::<CVImageBuffer>() }, presented_at);
            },
            SCStreamOutputType::Screen,
        )?;
        stream.start_capture()?;
        Ok(Self { stream })
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        if let Err(error) = self.stream.stop_capture() {
            warn!(%error, "capture did not stop cleanly");
        }
    }
}
