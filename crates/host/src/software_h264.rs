//! Software H.264 encoding with OpenH264, for hosts without a hardware encoder backend
//! yet. Real-time video mode, no frame skipping, keyframes only on request.

use anyhow::{Context, Result};
use openh264::OpenH264API;
use openh264::encoder::{
    BitRate, Encoder, EncoderConfig, FrameRate, IntraFramePeriod, Profile, UsageType,
};
use openh264::formats::{BgraSliceU8, YUVBuffer};

pub struct SoftwareEncoder {
    bitrate: u32,
    fps: u32,
    /// Created on the first frame and again whenever the picture size changes.
    current: Option<(Encoder, (usize, usize))>,
}

impl SoftwareEncoder {
    pub fn new(bitrate: u32, fps: u32) -> Self {
        Self {
            bitrate,
            fps,
            current: None,
        }
    }

    /// Encodes one BGRA frame of `width` × `height` pixels, packed rows. Returns the
    /// access unit in Annex B form, or `None` when the encoder had nothing to emit.
    pub fn encode(
        &mut self,
        bgra: &[u8],
        width: usize,
        height: usize,
        keyframe: bool,
    ) -> Result<Option<Vec<u8>>> {
        // H.264 works on 2×2 blocks of colour: drop a last odd row or column.
        let size = (width & !1, height & !1);
        let packed = crop(bgra, width, size);
        if self.current.as_ref().map(|(_, current)| *current) != Some(size) {
            self.current = Some((self.create(size)?, size));
        }
        let (encoder, _) = self.current.as_mut().expect("just created");
        if keyframe {
            encoder.force_intra_frame();
        }
        let yuv = YUVBuffer::from_rgb_source(BgraSliceU8::new(&packed, size));
        let annex_b = encoder
            .encode(&yuv)
            .context("OpenH264 encoding failed")?
            .to_vec();
        Ok((!annex_b.is_empty()).then_some(annex_b))
    }

    fn create(&self, size: (usize, usize)) -> Result<Encoder> {
        let config = EncoderConfig::new()
            // The screen content mode turns every frame into a keyframe; games look like
            // video anyway.
            .usage_type(UsageType::CameraVideoRealTime)
            .profile(Profile::Baseline)
            .bitrate(BitRate::from_bps(self.bitrate))
            .max_frame_rate(FrameRate::from_hz(self.fps as f32))
            .skip_frames(false)
            .scene_change_detect(false)
            .intra_frame_period(IntraFramePeriod::from_num_frames(self.fps * 60));
        Encoder::with_api_config(OpenH264API::from_source(), config)
            .with_context(|| format!("cannot start OpenH264 at {}×{}", size.0, size.1))
    }
}

/// The top-left `size` pixels of a BGRA picture `width` pixels wide.
fn crop(bgra: &[u8], width: usize, size: (usize, usize)) -> Vec<u8> {
    bgra.chunks_exact(width * 4)
        .take(size.1)
        .flat_map(|row| &row[..size.0 * 4])
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nal_types(annex_b: &[u8]) -> Vec<u8> {
        annex_b
            .windows(4)
            .enumerate()
            .filter(|(_, window)| *window == [0, 0, 0, 1])
            .filter_map(|(i, _)| annex_b.get(i + 4).map(|header| header & 0x1f))
            .collect()
    }

    fn grey_frame(width: usize, height: usize, shade: u8) -> Vec<u8> {
        [shade, shade, shade, 255].repeat(width * height)
    }

    #[test]
    fn first_frame_carries_parameter_sets_and_an_idr_slice() {
        let mut encoder = SoftwareEncoder::new(4_000_000, 60);
        let frame = encoder
            .encode(&grey_frame(64, 48, 90), 64, 48, false)
            .unwrap()
            .unwrap();
        let types = nal_types(&frame);
        assert!(types.contains(&7), "SPS missing: {types:?}");
        assert!(types.contains(&8), "PPS missing: {types:?}");
        assert!(types.contains(&5), "IDR slice missing: {types:?}");
    }

    #[test]
    fn a_keyframe_can_be_forced() {
        let mut encoder = SoftwareEncoder::new(4_000_000, 60);
        encoder
            .encode(&grey_frame(64, 48, 90), 64, 48, false)
            .unwrap();
        let delta = encoder
            .encode(&grey_frame(64, 48, 100), 64, 48, false)
            .unwrap();
        assert!(delta.is_none_or(|frame| !nal_types(&frame).contains(&5)));
        let forced = encoder
            .encode(&grey_frame(64, 48, 110), 64, 48, true)
            .unwrap()
            .unwrap();
        assert!(nal_types(&forced).contains(&5));
    }

    #[test]
    fn odd_sizes_lose_their_last_row_and_column() {
        assert_eq!(
            crop(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3, (2, 1)),
            [1, 2, 3, 4, 5, 6, 7, 8]
        );
        let mut encoder = SoftwareEncoder::new(4_000_000, 60);
        assert!(
            encoder
                .encode(&grey_frame(65, 49, 90), 65, 49, false)
                .unwrap()
                .is_some()
        );
    }
}
