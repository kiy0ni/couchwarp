//! H.264 for the Windows host: OpenH264 in software for now. The hardware encoders
//! (NVENC, AMF, Quick Sync through Media Foundation) are the next step.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use anyhow::Result;
use tokio::sync::mpsc;
use tracing::warn;

use crate::software_h264::SoftwareEncoder;
use crate::video::EncodedFrame;

pub struct EncoderSettings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
}

pub struct Encoder {
    software: Mutex<SoftwareEncoder>,
    frames: mpsc::Sender<EncodedFrame>,
    keyframe_wanted: Arc<AtomicBool>,
}

impl Encoder {
    /// The picture size follows the window, so `settings` only sets the rate and bitrate.
    pub fn new(
        settings: &EncoderSettings,
        frames: mpsc::Sender<EncodedFrame>,
        keyframe_wanted: Arc<AtomicBool>,
    ) -> Result<Self> {
        Ok(Self {
            software: Mutex::new(SoftwareEncoder::new(settings.bitrate, settings.fps)),
            frames,
            keyframe_wanted,
        })
    }

    /// Encodes one captured frame, BGRA with packed rows, and queues it for the network.
    pub fn encode_bgra(&self, bgra: &[u8], width: usize, height: usize, captured_at: Instant) {
        let keyframe = self.keyframe_wanted.swap(false, Ordering::AcqRel);
        let encoded = self
            .software
            .lock()
            .expect("only the capture thread encodes")
            .encode(bgra, width, height, keyframe);
        match encoded {
            Ok(Some(annex_b)) => {
                let frame = EncodedFrame {
                    annex_b: annex_b.into(),
                    captured_at,
                };
                // A full queue means the network side is behind. Dropping keeps latency
                // flat; the next keyframe repairs the picture.
                if self.frames.try_send(frame).is_err() {
                    self.keyframe_wanted.store(true, Ordering::Release);
                }
            }
            Ok(None) => {}
            Err(error) => warn!("{error:#}"),
        }
    }
}
