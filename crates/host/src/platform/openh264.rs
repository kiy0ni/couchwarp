//! H.264 for the Windows and Linux hosts. On Windows the graphics card encodes through
//! Media Foundation when it can (NVIDIA, AMD and Intel all offer an encoder there), and
//! OpenH264 encodes in software otherwise; Linux uses OpenH264 for now.

use std::sync::Mutex;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::software_h264::SoftwareEncoder;
use crate::video::{EncodedFrame, EncoderControl, STILL_AFTER};

pub struct EncoderSettings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
}

/// One H.264 encoder behind [`Encoder`]. Each call returns the access units it finished,
/// in Annex B form: usually the picture just given, none when it was skipped to hold the
/// bitrate.
pub trait Codec: Send {
    /// Encodes one BGRA picture with packed rows.
    fn encode(
        &mut self,
        bgra: &[u8],
        width: usize,
        height: usize,
        keyframe: bool,
    ) -> Result<Vec<Vec<u8>>>;
    /// Encodes the last picture again; nothing before the first one.
    fn repeat(&mut self, keyframe: bool) -> Result<Vec<Vec<u8>>>;
    /// Changes the target bitrate from the next picture.
    fn set_bitrate(&mut self, bitrate: u32) -> Result<()>;
    /// Says which encoder it is, for the log.
    fn name(&self) -> &str;
}

impl Codec for SoftwareEncoder {
    fn encode(
        &mut self,
        bgra: &[u8],
        width: usize,
        height: usize,
        keyframe: bool,
    ) -> Result<Vec<Vec<u8>>> {
        Ok(
            SoftwareEncoder::encode(self, bgra, width, height, keyframe)?
                .into_iter()
                .collect(),
        )
    }

    fn repeat(&mut self, keyframe: bool) -> Result<Vec<Vec<u8>>> {
        Ok(SoftwareEncoder::repeat(self, keyframe)?
            .into_iter()
            .collect())
    }

    fn set_bitrate(&mut self, bitrate: u32) -> Result<()> {
        SoftwareEncoder::set_bitrate(self, bitrate)
    }

    fn name(&self) -> &str {
        SOFTWARE_NAME
    }
}

pub struct Encoder {
    codec: Mutex<Box<dyn Codec>>,
    frames: mpsc::Sender<EncodedFrame>,
    control: EncoderControl,
    fps: u32,
    /// When the window last sent a frame.
    last_frame: Mutex<Instant>,
}

impl Encoder {
    /// Starts at the window's size; if the window is resized, the encoder follows.
    pub fn new(
        settings: &EncoderSettings,
        frames: mpsc::Sender<EncodedFrame>,
        control: EncoderControl,
    ) -> Result<Self> {
        let codec = best_codec(settings)?;
        info!(encoder = codec.name(), "video encoder ready");
        Ok(Self {
            codec: Mutex::new(codec),
            frames,
            control,
            fps: settings.fps,
            last_frame: Mutex::new(Instant::now()),
        })
    }

    /// Encodes one captured frame, BGRA with packed rows, and queues it for the network.
    pub fn encode_bgra(&self, bgra: &[u8], width: usize, height: usize, captured_at: Instant) {
        *self.last_frame.lock().expect("never poisoned") = captured_at;
        let keyframe = self.control.take_keyframe_request();
        let mut codec = self.codec.lock().expect("never poisoned");
        if let Err(error) = codec.set_bitrate(self.control.bitrate()) {
            warn!("{error:#}");
        }
        let encoded = codec.encode(bgra, width, height, keyframe);
        let encoded = self.fall_back_on_failure(&mut codec, encoded, |software| {
            software.encode(bgra, width, height, true)
        });
        drop(codec);
        self.send(encoded, keyframe, captured_at);
    }

    /// Sends the last picture again as a keyframe when a guest needs one and the window
    /// has drawn nothing lately (see `video::STILL_AFTER`).
    pub fn repeat_if_still(&self) {
        let still = self.last_frame.lock().expect("never poisoned").elapsed() >= STILL_AFTER;
        if !still || !self.control.take_keyframe_request() {
            return;
        }
        let encoded = self.codec.lock().expect("never poisoned").repeat(true);
        self.send(encoded, true, Instant::now());
    }

    /// A hardware encoder that fails mid-game (a driver reset, the card busy elsewhere)
    /// gives way to OpenH264 for the rest of the game, which redoes the picture.
    fn fall_back_on_failure(
        &self,
        codec: &mut Box<dyn Codec>,
        encoded: Result<Vec<Vec<u8>>>,
        redo: impl FnOnce(&mut Box<dyn Codec>) -> Result<Vec<Vec<u8>>>,
    ) -> Result<Vec<Vec<u8>>> {
        let Err(error) = encoded else {
            return encoded;
        };
        if codec.name() == SOFTWARE_NAME {
            return Err(error);
        }
        warn!(
            encoder = codec.name(),
            "{error:#}; encoding in software from now on"
        );
        *codec = Box::new(SoftwareEncoder::new(self.control.bitrate(), self.fps));
        redo(codec)
    }

    fn send(&self, encoded: Result<Vec<Vec<u8>>>, keyframe: bool, captured_at: Instant) {
        match encoded {
            Ok(units) if units.is_empty() => {
                // Skipped to hold the bitrate: a keyframe asked for is still owed.
                if keyframe {
                    self.control.want_keyframe();
                }
            }
            Ok(units) => {
                for annex_b in units {
                    let frame = EncodedFrame {
                        annex_b: annex_b.into(),
                        captured_at,
                    };
                    // A full queue means the network side is behind. Dropping keeps
                    // latency flat; the next keyframe repairs the picture.
                    if self.frames.try_send(frame).is_err() {
                        self.control.want_keyframe();
                    }
                }
            }
            Err(error) => {
                if keyframe {
                    self.control.want_keyframe();
                }
                warn!("{error:#}");
            }
        }
    }
}

const SOFTWARE_NAME: &str = "OpenH264 (software)";

/// The graphics card's encoder where there is one, unless `COUCHWARP_ENCODER=software`;
/// OpenH264 otherwise.
fn best_codec(settings: &EncoderSettings) -> Result<Box<dyn Codec>> {
    #[cfg(windows)]
    if std::env::var("COUCHWARP_ENCODER").as_deref() != Ok("software") {
        match super::windows::hardware::HardwareEncoder::new(
            (settings.width as usize, settings.height as usize),
            settings.fps,
            settings.bitrate,
        ) {
            Ok(hardware) => return Ok(Box::new(hardware)),
            Err(error) => info!("{error:#}; encoding in software"),
        }
    }
    let mut software = SoftwareEncoder::new(settings.bitrate, settings.fps);
    software.prepare(settings.width as usize, settings.height as usize)?;
    Ok(Box::new(software))
}
