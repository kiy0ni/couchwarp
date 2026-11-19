//! Hardware H.264 encoding with VideoToolbox, set up for latency first: real-time mode,
//! low-latency rate control, no frame reordering, keyframes only when a guest needs one.

use std::ffi::{c_int, c_void};
use std::ptr::{self, NonNull};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_media::{
    CMClock, CMFormatDescription, CMSampleBuffer, CMTime,
    CMVideoFormatDescriptionGetH264ParameterSetAtIndex, kCMVideoCodecType_H264,
};
use objc2_core_video::CVImageBuffer;
use objc2_video_toolbox::{
    VTCompressionSession, VTEncodeInfoFlags, VTSessionSetProperty,
    kVTCompressionPropertyKey_AllowFrameReordering, kVTCompressionPropertyKey_AverageBitRate,
    kVTCompressionPropertyKey_ExpectedFrameRate, kVTCompressionPropertyKey_MaxKeyFrameInterval,
    kVTCompressionPropertyKey_ProfileLevel, kVTCompressionPropertyKey_RealTime,
    kVTEncodeFrameOptionKey_ForceKeyFrame, kVTProfileLevel_H264_ConstrainedBaseline_AutoLevel,
    kVTVideoEncoderSpecification_EnableLowLatencyRateControl,
    kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder,
};
use tokio::sync::mpsc;
use tracing::{debug, warn};

use crate::avcc::{append_annex_b, append_parameter_set, has_idr_slice};
use crate::video::{EncodedFrame, EncoderControl};

/// Keyframes come on request. This only bounds how long a damaged picture could last.
const MAX_SECONDS_BETWEEN_KEYFRAMES: i32 = 60;

pub struct EncoderSettings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
}

pub struct Encoder {
    session: CFRetained<VTCompressionSession>,
    output: NonNull<Output>,
    control: EncoderControl,
    /// The bitrate the session runs at, to notice when the host asks for another.
    applied_bitrate: AtomicU32,
    frame_duration: CMTime,
}

// SAFETY: VideoToolbox compression sessions may be used from any thread. `output` is only
// read, from VideoToolbox's callback thread, and freed after the session is invalidated.
unsafe impl Send for Encoder {}
unsafe impl Sync for Encoder {}

/// What the encoder callback needs. Owned by [`Encoder`], lent to VideoToolbox.
struct Output {
    frames: mpsc::Sender<EncodedFrame>,
    control: EncoderControl,
    clock: HostClock,
}

impl Encoder {
    /// Encoded frames go to `frames`. `control` asks for keyframes and bitrate changes.
    pub fn new(
        settings: &EncoderSettings,
        frames: mpsc::Sender<EncodedFrame>,
        control: EncoderControl,
    ) -> Result<Self> {
        let specification = dictionary(&[
            (
                unsafe { kVTVideoEncoderSpecification_EnableLowLatencyRateControl },
                CFBoolean::new(true),
            ),
            (
                unsafe { kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder },
                CFBoolean::new(true),
            ),
        ]);
        let output = Box::into_raw(Box::new(Output {
            frames,
            control: control.clone(),
            clock: HostClock::now(),
        }));
        let mut session = ptr::null_mut();
        // SAFETY: every pointer is valid for the call; `output` outlives the session (see Drop).
        let status = unsafe {
            VTCompressionSession::create(
                None,
                settings.width as i32,
                settings.height as i32,
                kCMVideoCodecType_H264,
                Some(specification.as_opaque()),
                None,
                None,
                Some(on_encoded),
                output.cast(),
                NonNull::from(&mut session),
            )
        };
        let Some(session) = NonNull::new(session).filter(|_| status == 0) else {
            // SAFETY: the session was not created, so VideoToolbox holds no reference to it.
            drop(unsafe { Box::from_raw(output) });
            bail!("no hardware H.264 encoder available (VideoToolbox status {status})");
        };
        // SAFETY: `create` returned a +1 reference that we now own.
        let session = unsafe { CFRetained::from_raw(session) };

        let fps = settings.fps as i32;
        let properties: [(&CFString, &CFType); 6] = unsafe {
            [
                (kVTCompressionPropertyKey_RealTime, CFBoolean::new(true)),
                (
                    kVTCompressionPropertyKey_AllowFrameReordering,
                    CFBoolean::new(false),
                ),
                (
                    kVTCompressionPropertyKey_ProfileLevel,
                    kVTProfileLevel_H264_ConstrainedBaseline_AutoLevel,
                ),
                (
                    kVTCompressionPropertyKey_AverageBitRate,
                    &CFNumber::new_i32(settings.bitrate as i32),
                ),
                (
                    kVTCompressionPropertyKey_ExpectedFrameRate,
                    &CFNumber::new_i32(fps),
                ),
                (
                    kVTCompressionPropertyKey_MaxKeyFrameInterval,
                    &CFNumber::new_i32(fps * MAX_SECONDS_BETWEEN_KEYFRAMES),
                ),
            ]
        };
        for (key, value) in properties {
            // SAFETY: the session is live and the key and value are valid CF objects.
            let status = unsafe { VTSessionSetProperty(&session, key, Some(value)) };
            if status != 0 {
                bail!("encoder refused {key} (VideoToolbox status {status})");
            }
        }
        // SAFETY: the session is live.
        unsafe { session.prepare_to_encode_frames() };

        Ok(Self {
            session,
            // SAFETY: Box::into_raw never returns null.
            output: unsafe { NonNull::new_unchecked(output) },
            applied_bitrate: AtomicU32::new(settings.bitrate),
            control,
            // SAFETY: plain value constructor.
            frame_duration: unsafe { CMTime::new(1, fps) },
        })
    }

    /// Moves the session to the bitrate the host asks for, if it changed. VideoToolbox
    /// applies it from the next frame, without a keyframe.
    fn follow_bitrate(&self) {
        let wanted = self.control.bitrate();
        if self.applied_bitrate.swap(wanted, Ordering::AcqRel) == wanted {
            return;
        }
        let value = CFNumber::new_i32(i32::try_from(wanted).unwrap_or(i32::MAX));
        // SAFETY: the session is live and the key and value are valid CF objects.
        let status = unsafe {
            VTSessionSetProperty(
                &self.session,
                kVTCompressionPropertyKey_AverageBitRate,
                Some(&value),
            )
        };
        if status != 0 {
            warn!(status, "encoder refused the new bitrate");
        }
    }

    /// Queues one captured frame. `presented_at` is its timestamp on the host clock.
    pub fn encode(&self, image: &CVImageBuffer, presented_at: CMTime) {
        self.follow_bitrate();
        let force_keyframe = self.control.take_keyframe_request();
        let options = force_keyframe.then(|| {
            dictionary(&[(
                unsafe { kVTEncodeFrameOptionKey_ForceKeyFrame },
                CFBoolean::new(true),
            )])
        });
        // SAFETY: the session is live and `image` is a valid pixel buffer for this call;
        // VideoToolbox retains it for as long as it needs.
        let status = unsafe {
            self.session.encode_frame(
                image,
                presented_at,
                self.frame_duration,
                options.as_deref().map(CFDictionary::as_opaque),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if status != 0 {
            warn!(status, "frame not encoded");
        }
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        // SAFETY: invalidating flushes pending callbacks; none can run after this returns,
        // so freeing `output` afterwards is sound.
        unsafe {
            self.session.invalidate();
            drop(Box::from_raw(self.output.as_ptr()));
        }
    }
}

fn dictionary(
    entries: &[(&CFString, &CFBoolean)],
) -> CFRetained<CFDictionary<CFString, CFBoolean>> {
    let keys: Vec<&CFString> = entries.iter().map(|(key, _)| *key).collect();
    let values: Vec<&CFBoolean> = entries.iter().map(|(_, value)| *value).collect();
    CFDictionary::from_slices(&keys, &values)
}

/// Called by VideoToolbox on its own thread for every encoded (or dropped) frame.
unsafe extern "C-unwind" fn on_encoded(
    output: *mut c_void,
    _source_frame: *mut c_void,
    status: i32,
    _flags: VTEncodeInfoFlags,
    sample: *mut CMSampleBuffer,
) {
    // SAFETY: `output` is the pointer given at creation, valid until the session is invalidated.
    let output = unsafe { &*output.cast::<Output>() };
    // SAFETY: VideoToolbox passes either null (frame dropped) or a valid sample buffer.
    let Some(sample) = (unsafe { sample.as_ref() }).filter(|_| status == 0) else {
        debug!(status, "encoder dropped a frame");
        output.control.want_keyframe();
        return;
    };
    match encoded_frame(sample, output.clock) {
        Ok(frame) => {
            // A full queue means the network side is behind. Dropping keeps latency
            // flat; the next keyframe repairs the picture.
            if output.frames.try_send(frame).is_err() {
                output.control.want_keyframe();
            }
        }
        Err(error) => warn!(%error, "encoded frame unreadable"),
    }
}

fn encoded_frame(sample: &CMSampleBuffer, clock: HostClock) -> Result<EncodedFrame> {
    // SAFETY: `sample` is a valid encoded sample buffer for the duration of the callback.
    unsafe {
        let format = sample
            .format_description()
            .context("no format description")?;
        let (parameter_sets, length_size) = parameter_sets(&format)?;
        let block = sample.data_buffer().context("no data")?;
        let mut avcc = vec![0u8; block.data_length()];
        let destination = NonNull::new(avcc.as_mut_ptr().cast()).context("empty frame")?;
        let status = block.copy_data_bytes(0, avcc.len(), destination);
        if status != 0 {
            bail!("cannot read the encoded data (status {status})");
        }

        let mut annex_b = Vec::with_capacity(avcc.len() + 64);
        if has_idr_slice(&avcc, length_size) {
            for parameter_set in &parameter_sets {
                append_parameter_set(parameter_set, &mut annex_b);
            }
        }
        append_annex_b(&avcc, length_size, &mut annex_b)
            .map_err(|_| anyhow::anyhow!("malformed NAL unit lengths"))?;
        Ok(EncodedFrame {
            annex_b: annex_b.into(),
            captured_at: clock.instant(sample.presentation_time_stamp()),
        })
    }
}

/// SPS and PPS, copied out, and the size of the NAL length prefixes.
///
/// # Safety
/// `format` must be an H.264 video format description.
unsafe fn parameter_sets(format: &CMFormatDescription) -> Result<(Vec<Vec<u8>>, usize)> {
    let mut count = 0usize;
    let mut length_size: c_int = 0;
    // SAFETY: null out-pointers are allowed; this call only reads the count.
    let status = unsafe {
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut count,
            &mut length_size,
        )
    };
    if status != 0 {
        bail!("no H.264 parameter sets (status {status})");
    }
    let mut sets = Vec::with_capacity(count);
    for index in 0..count {
        let mut pointer: *const u8 = ptr::null();
        let mut size = 0usize;
        // SAFETY: valid out-pointers; the returned bytes live as long as `format`.
        let status = unsafe {
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                format,
                index,
                &mut pointer,
                &mut size,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if status != 0 || pointer.is_null() {
            bail!("parameter set {index} unreadable (status {status})");
        }
        // SAFETY: VideoToolbox guarantees `size` readable bytes at `pointer`.
        sets.push(unsafe { std::slice::from_raw_parts(pointer, size) }.to_vec());
    }
    Ok((sets, length_size as usize))
}

/// Converts CoreMedia host-clock times, which ScreenCaptureKit stamps frames with, into
/// [`Instant`]s. Both read the same monotonic clock, so one reading pairs them for good.
#[derive(Clone, Copy)]
pub struct HostClock {
    host_seconds: f64,
    instant: Instant,
}

impl HostClock {
    pub fn now() -> Self {
        // SAFETY: plain reads of the system host clock.
        let host_seconds = unsafe { CMClock::host_time_clock().time().seconds() };
        Self {
            host_seconds,
            instant: Instant::now(),
        }
    }

    pub fn instant(&self, time: CMTime) -> Instant {
        // SAFETY: plain value conversion.
        let delta = unsafe { time.seconds() } - self.host_seconds;
        if delta >= 0.0 {
            self.instant + Duration::from_secs_f64(delta)
        } else {
            self.instant
                .checked_sub(Duration::from_secs_f64(-delta))
                .unwrap_or(self.instant)
        }
    }
}
