//! H.264 for the Windows and Linux hosts: OpenH264 in software for now. The hardware
//! encoders (NVENC, AMF, Quick Sync; VA-API on Linux) are the next step.

use std::sync::Mutex;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::mpsc;
use tracing::warn;

use crate::software_h264::SoftwareEncoder;
use crate::video::{EncodedFrame, EncoderControl, STILL_AFTER};

pub struct EncoderSettings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
}

pub struct Encoder {
    software: Mutex<SoftwareEncoder>,
    frames: mpsc::Sender<EncodedFrame>,
    control: EncoderControl,
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
        let mut software = SoftwareEncoder::new(settings.bitrate, settings.fps);
        software.prepare(settings.width as usize, settings.height as usize)?;
        Ok(Self {
            software: Mutex::new(software),
            frames,
            control,
            last_frame: Mutex::new(Instant::now()),
        })
    }

    /// Encodes one captured frame, BGRA with packed rows, and queues it for the network.
    pub fn encode_bgra(&self, bgra: &[u8], width: usize, height: usize, captured_at: Instant) {
        *self.last_frame.lock().expect("never poisoned") = captured_at;
        let keyframe = self.control.take_keyframe_request();
        let mut software = self.software.lock().expect("never poisoned");
        if let Err(error) = software.set_bitrate(self.control.bitrate()) {
            warn!("{error:#}");
        }
        let encoded = software.encode(bgra, width, height, keyframe);
        drop(software);
        self.send(encoded, keyframe, captured_at);
    }

    /// Sends the last picture again as a keyframe when a guest needs one and the window
    /// has drawn nothing lately (see `video::STILL_AFTER`).
    pub fn repeat_if_still(&self) {
        let still = self.last_frame.lock().expect("never poisoned").elapsed() >= STILL_AFTER;
        if !still || !self.control.take_keyframe_request() {
            return;
        }
        let encoded = self.software.lock().expect("never poisoned").repeat(true);
        self.send(encoded, true, Instant::now());
    }

    fn send(&self, encoded: Result<Option<Vec<u8>>>, keyframe: bool, captured_at: Instant) {
        match encoded {
            Ok(Some(annex_b)) => {
                let frame = EncodedFrame {
                    annex_b: annex_b.into(),
                    captured_at,
                };
                // A full queue means the network side is behind. Dropping keeps latency
                // flat; the next keyframe repairs the picture.
                if self.frames.try_send(frame).is_err() {
                    self.control.want_keyframe();
                }
            }
            // Skipped to hold the bitrate: a keyframe asked for is still owed.
            Ok(None) => {
                if keyframe {
                    self.control.want_keyframe();
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
