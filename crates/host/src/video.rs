//! Encoded frames on their way to guests, and the clock that stamps them.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const RTP_VIDEO_CLOCK_HZ: u128 = 90_000;

/// A window that has drawn nothing for this long is still. Capture sends a frame only when
/// the picture changes, so a menu, a pause screen or a launcher sends none: a guest who
/// arrives then, or loses a packet, would wait for a picture that never comes. The encoder
/// sends its last one again instead.
pub const STILL_AFTER: Duration = Duration::from_millis(100);
/// How often a still window is checked for a guest waiting on a whole picture.
pub const STILL_CHECK: Duration = Duration::from_millis(50);

/// One H.264 access unit in Annex B form (NAL units after start codes), as str0m sends it.
pub struct EncodedFrame {
    /// Shared, because the same frame goes to every guest.
    pub annex_b: Arc<[u8]>,
    /// When the frame was captured, on this machine's monotonic clock.
    pub captured_at: Instant,
}

/// What the host asks of the encoder while it runs. The encoder reads both on every
/// frame, so a request takes effect on the next one.
#[derive(Clone)]
pub struct EncoderControl {
    keyframe_wanted: Arc<AtomicBool>,
    bitrate: Arc<AtomicU32>,
}

impl EncoderControl {
    /// Starts at `bitrate`, with a keyframe first.
    pub fn new(bitrate: u32) -> Self {
        Self {
            keyframe_wanted: Arc::new(AtomicBool::new(true)),
            bitrate: Arc::new(AtomicU32::new(bitrate)),
        }
    }

    pub fn want_keyframe(&self) {
        self.keyframe_wanted.store(true, Ordering::Release);
    }

    /// True once per request.
    pub fn take_keyframe_request(&self) -> bool {
        self.keyframe_wanted.swap(false, Ordering::AcqRel)
    }

    pub fn set_bitrate(&self, bits_per_second: u32) {
        self.bitrate.store(bits_per_second, Ordering::Release);
    }

    pub fn bitrate(&self) -> u32 {
        self.bitrate.load(Ordering::Acquire)
    }
}

/// Maps capture instants to RTP timestamps. Guests learn `epoch_unix_ms` and can then
/// turn any frame's RTP timestamp back into the time it was captured.
pub struct StreamClock {
    epoch: Instant,
    epoch_unix_ms: u64,
}

impl StreamClock {
    pub fn start() -> Self {
        let since_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO);
        Self {
            epoch: Instant::now(),
            epoch_unix_ms: since_unix.as_millis() as u64,
        }
    }

    pub fn epoch_unix_ms(&self) -> u64 {
        self.epoch_unix_ms
    }

    /// 90 kHz ticks since the epoch, the RTP clock of every video codec.
    pub fn rtp_ticks(&self, at: Instant) -> u64 {
        (at.saturating_duration_since(self.epoch).as_micros() * RTP_VIDEO_CLOCK_HZ / 1_000_000)
            as u64
    }
}

/// Unix time in milliseconds, with sub-millisecond precision.
pub fn unix_ms_now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs_f64()
        * 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rtp_ticks_count_at_90_khz() {
        let clock = StreamClock::start();
        let one_second_later = clock.epoch + Duration::from_secs(1);
        assert_eq!(clock.rtp_ticks(one_second_later), 90_000);
        assert_eq!(
            clock.rtp_ticks(clock.epoch + Duration::from_micros(11_112)),
            1000
        );
        // A frame stamped before the epoch counts as tick 0, never wraps backwards.
        assert_eq!(clock.rtp_ticks(clock.epoch - Duration::from_millis(5)), 0);
    }
}
