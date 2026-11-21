//! Software H.264 encoding with OpenH264, for hosts without a hardware encoder backend
//! yet. Real-time video mode, keyframes only on request. The encoder may skip a frame to
//! hold the bitrate: on a slow connection, a dropped frame beats a growing delay.

use anyhow::{Context, Result};
use openh264::OpenH264API;
use openh264::encoder::{
    BitRate, Encoder, EncoderConfig, FrameRate, IntraFramePeriod, Profile, UsageType,
};
use openh264::formats::{BgraSliceU8, YUVBuffer};
use openh264_sys2::{ENCODER_OPTION_BITRATE, SBitrateInfo, SPATIAL_LAYER_ALL};

pub struct SoftwareEncoder {
    bitrate: u32,
    fps: u32,
    /// Created on the first frame and again whenever the picture size changes.
    current: Option<(Encoder, (usize, usize))>,
    /// The last picture encoded, to send again while the window shows nothing new.
    last: Option<YUVBuffer>,
}

impl SoftwareEncoder {
    pub fn new(bitrate: u32, fps: u32) -> Self {
        Self {
            bitrate,
            fps,
            current: None,
            last: None,
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
        self.prepare(size.0, size.1)?;
        self.last = Some(YUVBuffer::from_rgb_source(BgraSliceU8::new(&packed, size)));
        self.encode_last(keyframe)
    }

    /// Encodes the last picture again. A window that does not change sends no new frame,
    /// yet a guest who just arrived needs a whole picture to start from. `None` before
    /// the first frame.
    pub fn repeat(&mut self, keyframe: bool) -> Result<Option<Vec<u8>>> {
        if self.last.is_none() {
            return Ok(None);
        }
        self.encode_last(keyframe)
    }

    fn encode_last(&mut self, keyframe: bool) -> Result<Option<Vec<u8>>> {
        let (Some((encoder, _)), Some(yuv)) = (self.current.as_mut(), self.last.as_ref()) else {
            return Ok(None);
        };
        if keyframe {
            encoder.force_intra_frame();
        }
        let annex_b = encoder
            .encode(yuv)
            .context("OpenH264 encoding failed")?
            .to_vec();
        Ok((!annex_b.is_empty()).then_some(annex_b))
    }

    /// Changes the target bitrate of the running encoder from the next frame, without a
    /// keyframe. Encoders started later use it too.
    pub fn set_bitrate(&mut self, bitrate: u32) -> Result<()> {
        if bitrate == self.bitrate {
            return Ok(());
        }
        self.bitrate = bitrate;
        let Some((encoder, _)) = self.current.as_mut() else {
            return Ok(());
        };
        let mut info = SBitrateInfo {
            iLayer: SPATIAL_LAYER_ALL,
            iBitrate: i32::try_from(bitrate).unwrap_or(i32::MAX),
        };
        // SAFETY: the encoder is initialized, and the option takes a pointer to an
        // SBitrateInfo that lives for the call.
        let status = unsafe {
            encoder
                .raw_api()
                .set_option(ENCODER_OPTION_BITRATE, (&raw mut info).cast())
        };
        anyhow::ensure!(
            status == 0,
            "OpenH264 refused bitrate {bitrate} (status {status})"
        );
        Ok(())
    }

    /// Starts the encoder for pictures of this size, unless it already runs at that size.
    /// Doing it before the first frame keeps the setup out of the first frame's latency.
    pub fn prepare(&mut self, width: usize, height: usize) -> Result<()> {
        let size = (width & !1, height & !1);
        if self.current.as_ref().map(|(_, current)| *current) != Some(size) {
            self.current = Some((self.create(size)?, size));
        }
        Ok(())
    }

    fn create(&self, size: (usize, usize)) -> Result<Encoder> {
        let config = EncoderConfig::new()
            // The screen content mode turns every frame into a keyframe; games look like
            // video anyway.
            .usage_type(UsageType::CameraVideoRealTime)
            .profile(Profile::Baseline)
            .bitrate(BitRate::from_bps(self.bitrate))
            .max_frame_rate(FrameRate::from_hz(self.fps as f32))
            .skip_frames(true)
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

    /// NAL unit type of a slice of an IDR picture (a keyframe).
    const IDR_SLICE_NAL: u8 = 5;

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
    fn the_bitrate_changes_without_a_keyframe() {
        let mut encoder = SoftwareEncoder::new(8_000_000, 60);
        let first = encoder
            .encode(&grey_frame(64, 64, 10), 64, 64, false)
            .unwrap()
            .unwrap();
        assert!(nal_types(&first).contains(&IDR_SLICE_NAL));
        encoder.set_bitrate(2_000_000).unwrap();
        let next = encoder
            .encode(&grey_frame(64, 64, 200), 64, 64, false)
            .unwrap()
            .unwrap();
        assert!(!nal_types(&next).contains(&IDR_SLICE_NAL));
    }

    #[test]
    fn the_last_picture_can_be_sent_again_as_a_keyframe() {
        let mut encoder = SoftwareEncoder::new(4_000_000, 60);
        assert!(encoder.repeat(true).unwrap().is_none());
        encoder
            .encode(&grey_frame(64, 48, 90), 64, 48, false)
            .unwrap();
        let again = encoder.repeat(true).unwrap().unwrap();
        assert!(nal_types(&again).contains(&IDR_SLICE_NAL));
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
