//! The game's sound: stereo samples in, 10 ms Opus packets out, as WebRTC carries them.

use anyhow::{Context, Result};
use opus::{Application, Bitrate, Channels, Encoder};

pub const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: usize = 2;
/// 10 ms per packet: half the usual 20 ms, for half the buffering delay.
const FRAME_SAMPLES: usize = SAMPLE_RATE as usize / 100;
/// Enough for music and effects in stereo; voice-only would need far less.
const BITRATE: i32 = 128_000;
const MAX_PACKET: usize = 1500;

/// One Opus packet and its RTP timestamp, which counts samples at 48 kHz.
pub struct AudioPacket {
    pub opus: Vec<u8>,
    pub rtp_ticks: u64,
}

pub struct AudioEncoder {
    encoder: Encoder,
    pending: Vec<f32>,
    samples_sent: u64,
}

impl AudioEncoder {
    pub fn new() -> Result<Self> {
        let mut encoder = Encoder::new(SAMPLE_RATE, Channels::Stereo, Application::LowDelay)
            .context("cannot create the Opus encoder")?;
        encoder
            .set_bitrate(Bitrate::Bits(BITRATE))
            .context("Opus refused the bitrate")?;
        Ok(Self {
            encoder,
            pending: Vec::with_capacity(FRAME_SAMPLES * CHANNELS * 2),
            samples_sent: 0,
        })
    }

    /// Takes interleaved stereo samples and returns every full packet they complete.
    /// A partial packet waits for the next call.
    pub fn push(&mut self, interleaved: &[f32]) -> Result<Vec<AudioPacket>> {
        self.pending.extend_from_slice(interleaved);
        let frame_len = FRAME_SAMPLES * CHANNELS;
        let mut packets = Vec::new();
        let mut start = 0;
        while self.pending.len() - start >= frame_len {
            let mut opus = vec![0u8; MAX_PACKET];
            let size = self
                .encoder
                .encode_float(&self.pending[start..start + frame_len], &mut opus)
                .context("Opus encoding failed")?;
            opus.truncate(size);
            packets.push(AudioPacket {
                opus,
                rtp_ticks: self.samples_sent,
            });
            self.samples_sent += FRAME_SAMPLES as u64;
            start += frame_len;
        }
        self.pending.drain(..start);
        Ok(packets)
    }
}

/// Interleaves one buffer per channel (`[L L L] [R R R]`) into `[L R L R L R]`.
/// A mono source is played on both sides.
pub fn interleave(planes: &[&[f32]]) -> Vec<f32> {
    match planes {
        [mono] => mono.iter().flat_map(|&sample| [sample, sample]).collect(),
        [left, right, ..] => left
            .iter()
            .zip(*right)
            .flat_map(|(&l, &r)| [l, r])
            .collect(),
        [] => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(frames: usize) -> Vec<f32> {
        (0..frames)
            .flat_map(|i| {
                let sample =
                    (i as f32 * 440.0 * std::f32::consts::TAU / SAMPLE_RATE as f32).sin() * 0.5;
                [sample, sample]
            })
            .collect()
    }

    #[test]
    fn packets_hold_ten_milliseconds_and_count_samples() {
        let mut encoder = AudioEncoder::new().unwrap();
        // 25 ms of sound: two full packets, 5 ms left waiting.
        let packets = encoder.push(&tone(1200)).unwrap();
        assert_eq!(
            packets.iter().map(|p| p.rtp_ticks).collect::<Vec<_>>(),
            [0, 480]
        );
        assert!(packets.iter().all(|p| !p.opus.is_empty()));
        // Another 5 ms completes the third packet.
        let packets = encoder.push(&tone(240)).unwrap();
        assert_eq!(
            packets.iter().map(|p| p.rtp_ticks).collect::<Vec<_>>(),
            [960]
        );
    }

    #[test]
    fn packets_decode_back_to_ten_milliseconds() {
        let mut encoder = AudioEncoder::new().unwrap();
        let packet = encoder.push(&tone(480)).unwrap().remove(0);
        let mut decoder = opus::Decoder::new(SAMPLE_RATE, Channels::Stereo).unwrap();
        let mut output = vec![0f32; FRAME_SAMPLES * CHANNELS];
        let frames = decoder
            .decode_float(&packet.opus, &mut output, false)
            .unwrap();
        assert_eq!(frames, FRAME_SAMPLES);
    }

    #[test]
    fn channels_are_interleaved() {
        assert_eq!(
            interleave(&[&[1.0, 2.0], &[-1.0, -2.0]]),
            [1.0, -1.0, 2.0, -2.0]
        );
        assert_eq!(interleave(&[&[0.5]]), [0.5, 0.5]);
    }
}
