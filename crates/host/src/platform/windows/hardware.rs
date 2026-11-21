//! H.264 on the graphics card through Media Foundation: the system lists the encoders the
//! drivers install (NVIDIA NVENC, AMD AMF, Intel Quick Sync) behind one interface. Set up
//! for latency: constant bitrate, low-latency mode, no B-frames, keyframes on request.
//!
//! Hardware encoders work asynchronously: they say when they want a picture and when one
//! is done, through events. Each call feeds one picture and waits a little for it, so a
//! picture leaves as soon as the card has it, without a thread of its own.

use std::mem::ManuallyDrop;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use tracing::debug;
use windows::Win32::Media::MediaFoundation::{
    CODECAPI_AVEncCommonMeanBitRate, CODECAPI_AVEncCommonRateControlMode,
    CODECAPI_AVEncMPVDefaultBPictureCount, CODECAPI_AVEncMPVGOPSize,
    CODECAPI_AVEncVideoForceKeyFrame, CODECAPI_AVLowLatencyMode, ICodecAPI, IMFActivate,
    IMFMediaEventGenerator, IMFMediaType, IMFSample, IMFTransform, METransformHaveOutput,
    METransformNeedInput, MF_E_NO_EVENTS_AVAILABLE, MF_E_TRANSFORM_NEED_MORE_INPUT,
    MF_E_TRANSFORM_STREAM_CHANGE, MF_EVENT_FLAG_NO_WAIT, MF_LOW_LATENCY, MF_MT_AVG_BITRATE,
    MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE,
    MF_MT_MPEG_SEQUENCE_HEADER, MF_MT_MPEG2_PROFILE, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE,
    MF_TRANSFORM_ASYNC, MF_TRANSFORM_ASYNC_UNLOCK, MF_VERSION, MFCreateMediaType,
    MFCreateMemoryBuffer, MFCreateSample, MFMediaType_Video, MFSTARTUP_NOSOCKET,
    MFSampleExtension_CleanPoint, MFStartup, MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG,
    MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER, MFT_FRIENDLY_NAME_Attribute,
    MFT_MESSAGE_COMMAND_FLUSH, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING,
    MFT_MESSAGE_NOTIFY_END_OF_STREAM, MFT_MESSAGE_NOTIFY_END_STREAMING,
    MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_OUTPUT_DATA_BUFFER, MFT_OUTPUT_STREAM_PROVIDES_SAMPLES,
    MFT_REGISTER_TYPE_INFO, MFTEnumEx, MFVideoFormat_H264, MFVideoFormat_NV12,
    MFVideoInterlace_Progressive, eAVEncCommonRateControlMode_CBR, eAVEncH264VProfile_Base,
    eAVEncH264VProfile_ConstrainedBase,
};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoTaskMemFree};
use windows::Win32::System::Variant::VARIANT;
use windows::core::{GUID, Interface, PWSTR};

use crate::nv12;
use crate::platform::openh264::Codec;

/// How long a picture waits for the encoder to take it before it is skipped.
const INPUT_WAIT: Duration = Duration::from_millis(30);
/// How long a picture waits to come out before the call returns; it then leaves with the
/// next one.
const OUTPUT_WAIT: Duration = Duration::from_millis(30);
const WAIT_STEP: Duration = Duration::from_micros(250);
/// NAL unit type of a sequence parameter set.
const SPS: u8 = 7;
/// Room for one encoded picture, when the encoder does not bring its own.
const OUTPUT_BUFFER: u32 = 4 << 20;

thread_local! {
    /// Media Foundation runs in the multithreaded COM apartment, on every thread that
    /// calls it. Capture calls from a thread of its own.
    static COM: () = {
        // SAFETY: plain call. A thread already in another apartment keeps it.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    };
}

pub struct HardwareEncoder {
    activate: IMFActivate,
    transform: IMFTransform,
    /// Only asynchronous encoders, which all hardware ones are, send events.
    events: Option<IMFMediaEventGenerator>,
    codec: Option<ICodecAPI>,
    name: String,
    size: (usize, usize),
    fps: u32,
    bitrate: u32,
    /// Pictures the encoder asked for and has not had yet.
    wanted: u32,
    /// Encoded pictures waiting to be collected.
    ready: u32,
    /// SPS and PPS, put before keyframes that come without them.
    sequence_header: Option<Vec<u8>>,
    /// The last picture, kept to send again while the window is still.
    nv12: Vec<u8>,
    has_picture: bool,
    started: Instant,
}

// SAFETY: Media Foundation objects live in the multithreaded apartment and may be called
// from any thread in it; every call here goes through `&mut self`, one at a time.
unsafe impl Send for HardwareEncoder {}

impl HardwareEncoder {
    /// The first hardware H.264 encoder the system offers, set up for pictures of `size`.
    pub fn new(size: (usize, usize), fps: u32, bitrate: u32) -> Result<Self> {
        COM.with(|()| ());
        // SAFETY: plain call; Media Foundation counts starts.
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET) }.context("Media Foundation")?;
        let (activate, transform, name) = first_hardware_encoder()?;
        let size = (size.0 & !1, size.1 & !1);
        let mut encoder = Self {
            activate,
            events: None,
            codec: transform.cast().ok(),
            transform,
            name,
            size,
            fps: fps.max(1),
            bitrate,
            wanted: 0,
            ready: 0,
            sequence_header: None,
            nv12: Vec::new(),
            has_picture: false,
            started: Instant::now(),
        };
        encoder
            .configure()
            .with_context(|| format!("{} refused the settings", encoder.name))?;
        Ok(encoder)
    }

    fn configure(&mut self) -> Result<()> {
        // SAFETY: every call below is on live objects with valid arguments.
        unsafe {
            let attributes = self.transform.GetAttributes()?;
            if attributes.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) == 1 {
                attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?;
                self.events = Some(self.transform.cast()?);
            }
            let _ = attributes.SetUINT32(&MF_LOW_LATENCY, 1);
        }
        self.set(
            &CODECAPI_AVEncCommonRateControlMode,
            eAVEncCommonRateControlMode_CBR.0 as u32,
        );
        self.set(&CODECAPI_AVEncCommonMeanBitRate, self.bitrate);
        self.set(&CODECAPI_AVEncMPVGOPSize, self.fps * 60);
        self.set(&CODECAPI_AVEncMPVDefaultBPictureCount, 0);
        if let Some(codec) = &self.codec {
            // SAFETY: the codec interface is live; the value lives for the call.
            let _ = unsafe { codec.SetValue(&CODECAPI_AVLowLatencyMode, &VARIANT::from(true)) };
        }

        // Encoders take the output type first. Constrained baseline is what browsers
        // decode everywhere; an encoder that lacks the name gets plain baseline.
        let output = self
            .media_type(
                MFVideoFormat_H264,
                eAVEncH264VProfile_ConstrainedBase.0 as u32,
            )
            .and_then(|output| {
                // SAFETY: both objects are live.
                unsafe { self.transform.SetOutputType(0, &output, 0) }.map_err(Into::into)
            });
        if output.is_err() {
            let output = self.media_type(MFVideoFormat_H264, eAVEncH264VProfile_Base.0 as u32)?;
            // SAFETY: both objects are live.
            unsafe { self.transform.SetOutputType(0, &output, 0) }.context("output type")?;
        }
        let input = self.media_type(MFVideoFormat_NV12, 0)?;
        // SAFETY: both objects are live.
        unsafe {
            self.transform
                .SetInputType(0, &input, 0)
                .context("input type")?;
            self.transform
                .ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)?;
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }
        Ok(())
    }

    /// A video type of this encoder's size and rate; `profile` 0 for the input.
    fn media_type(&self, subtype: GUID, profile: u32) -> Result<IMFMediaType> {
        let (width, height) = (self.size.0 as u64, self.size.1 as u64);
        // SAFETY: a new media type, filled with plain values.
        unsafe {
            let kind = MFCreateMediaType()?;
            kind.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            kind.SetGUID(&MF_MT_SUBTYPE, &subtype)?;
            kind.SetUINT64(&MF_MT_FRAME_SIZE, (width << 32) | height)?;
            kind.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(self.fps) << 32) | 1)?;
            kind.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1 << 32) | 1)?;
            kind.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            if profile != 0 {
                kind.SetUINT32(&MF_MT_AVG_BITRATE, self.bitrate)?;
                kind.SetUINT32(&MF_MT_MPEG2_PROFILE, profile)?;
            }
            Ok(kind)
        }
    }

    /// Sets one encoder property, if the encoder has it.
    fn set(&self, property: &GUID, value: u32) {
        if let Some(codec) = &self.codec {
            // SAFETY: the codec interface is live; the value lives for the call.
            if let Err(error) = unsafe { codec.SetValue(property, &VARIANT::from(value)) } {
                debug!(%error, ?property, "encoder property not set");
            }
        }
    }

    /// Feeds the picture in `self.nv12` and returns what came out by the time it is done.
    fn encode_current(&mut self, keyframe: bool) -> Result<Vec<Vec<u8>>> {
        COM.with(|()| ());
        let mut done = Vec::new();
        if self.events.is_none() {
            return self.encode_synchronously(keyframe);
        }
        let deadline = Instant::now() + INPUT_WAIT;
        while self.wanted == 0 {
            self.collect_ready(&mut done)?;
            if !self.next_event()? {
                if Instant::now() >= deadline {
                    // Still busy with earlier pictures: this one is skipped.
                    return Ok(done);
                }
                std::thread::sleep(WAIT_STEP);
            }
        }
        self.wanted -= 1;
        self.feed(keyframe)?;
        let deadline = Instant::now() + OUTPUT_WAIT;
        let before = done.len();
        while done.len() == before && Instant::now() < deadline {
            self.collect_ready(&mut done)?;
            if done.len() == before && !self.next_event()? {
                std::thread::sleep(WAIT_STEP);
            }
        }
        Ok(done)
    }

    /// A synchronous encoder takes the picture and gives back what it can at once.
    fn encode_synchronously(&mut self, keyframe: bool) -> Result<Vec<Vec<u8>>> {
        self.feed(keyframe)?;
        let mut done = Vec::new();
        while let Some(unit) = self.collect()? {
            done.push(unit);
        }
        Ok(done)
    }

    /// Reads one event if there is one. Returns whether there was.
    fn next_event(&mut self) -> Result<bool> {
        let Some(events) = &self.events else {
            return Ok(false);
        };
        // SAFETY: the generator is live.
        let event = match unsafe { events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } {
            Ok(event) => event,
            Err(error) if error.code() == MF_E_NO_EVENTS_AVAILABLE => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        // SAFETY: the event is live.
        let kind = unsafe { event.GetType()? };
        if kind == METransformNeedInput.0 as u32 {
            self.wanted += 1;
        } else if kind == METransformHaveOutput.0 as u32 {
            self.ready += 1;
        }
        Ok(true)
    }

    fn collect_ready(&mut self, done: &mut Vec<Vec<u8>>) -> Result<()> {
        while self.ready > 0 {
            self.ready -= 1;
            if let Some(unit) = self.collect()? {
                done.push(unit);
            }
        }
        Ok(())
    }

    fn feed(&mut self, keyframe: bool) -> Result<()> {
        let length = u32::try_from(self.nv12.len())?;
        // 100-nanosecond units, always rising, repeats included.
        let time = i64::try_from(self.started.elapsed().as_nanos() / 100)?;
        // SAFETY: the buffer is locked for exactly the copy and holds `length` bytes.
        unsafe {
            let buffer = MFCreateMemoryBuffer(length)?;
            let mut data = std::ptr::null_mut();
            buffer.Lock(&mut data, None, None)?;
            std::ptr::copy_nonoverlapping(self.nv12.as_ptr(), data, self.nv12.len());
            buffer.Unlock()?;
            buffer.SetCurrentLength(length)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration(10_000_000 / i64::from(self.fps))?;
            if keyframe {
                self.set(&CODECAPI_AVEncVideoForceKeyFrame, 1);
            }
            self.transform.ProcessInput(0, &sample, 0)?;
        }
        Ok(())
    }

    /// Takes one encoded picture out, if one is there.
    fn collect(&mut self) -> Result<Option<Vec<u8>>> {
        // SAFETY: the transform is live; the output buffer is filled by the call and its
        // fields are taken back right after.
        let (result, sample) = unsafe {
            let info = self.transform.GetOutputStreamInfo(0)?;
            let own = info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 != 0;
            let sample = if own {
                None
            } else {
                Some(empty_sample(info.cbSize.max(OUTPUT_BUFFER))?)
            };
            let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
                dwStreamID: 0,
                pSample: ManuallyDrop::new(sample),
                dwStatus: 0,
                pEvents: ManuallyDrop::new(None),
            }];
            let mut status = 0;
            let result = self.transform.ProcessOutput(0, &mut buffers, &mut status);
            let sample = ManuallyDrop::take(&mut buffers[0].pSample);
            drop(ManuallyDrop::take(&mut buffers[0].pEvents));
            (result, sample)
        };
        match result {
            Ok(()) => {}
            Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(None),
            Err(error) if error.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                // SAFETY: the transform is live.
                unsafe {
                    let kind = self.transform.GetOutputAvailableType(0, 0)?;
                    self.transform.SetOutputType(0, &kind, 0)?;
                }
                self.sequence_header = None;
                return Ok(None);
            }
            Err(error) => return Err(anyhow!(error).context("the encoder failed")),
        }
        let sample = sample.ok_or_else(|| anyhow!("the encoder gave no picture"))?;
        let mut unit = read_sample(&sample)?;
        // SAFETY: the sample is live.
        let keyframe = unsafe { sample.GetUINT32(&MFSampleExtension_CleanPoint) }.unwrap_or(0) == 1;
        if keyframe && !has_nal(&unit, SPS) {
            if self.sequence_header.is_none() {
                self.sequence_header = self.read_sequence_header();
            }
            if let Some(header) = &self.sequence_header {
                unit.splice(0..0, header.iter().copied());
            }
        }
        Ok((!unit.is_empty()).then_some(unit))
    }

    fn read_sequence_header(&self) -> Option<Vec<u8>> {
        // SAFETY: the transform is live; the blob is copied and freed.
        unsafe {
            let kind = self.transform.GetOutputCurrentType(0).ok()?;
            let mut data = std::ptr::null_mut();
            let mut length = 0;
            kind.GetAllocatedBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut data, &mut length)
                .ok()?;
            let header = std::slice::from_raw_parts(data, length as usize).to_vec();
            CoTaskMemFree(Some(data.cast()));
            Some(header)
        }
    }
}

impl Codec for HardwareEncoder {
    fn encode(
        &mut self,
        bgra: &[u8],
        width: usize,
        height: usize,
        keyframe: bool,
    ) -> Result<Vec<Vec<u8>>> {
        let size = (width & !1, height & !1);
        if size != self.size {
            // A resized window needs an encoder of its size.
            *self = Self::new(size, self.fps, self.bitrate)?;
        }
        nv12::from_bgra(bgra, width, height, &mut self.nv12);
        self.has_picture = true;
        self.encode_current(keyframe)
    }

    fn repeat(&mut self, keyframe: bool) -> Result<Vec<Vec<u8>>> {
        if !self.has_picture {
            return Ok(Vec::new());
        }
        self.encode_current(keyframe)
    }

    fn set_bitrate(&mut self, bitrate: u32) -> Result<()> {
        if bitrate != self.bitrate {
            self.bitrate = bitrate;
            self.set(&CODECAPI_AVEncCommonMeanBitRate, bitrate);
        }
        Ok(())
    }

    fn name(&self) -> &str {
        &self.name
    }
}

impl Drop for HardwareEncoder {
    fn drop(&mut self) {
        // SAFETY: the objects are live until here.
        unsafe {
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            let _ = self.activate.ShutdownObject();
        }
    }
}

/// The hardware H.264 encoders the system lists, best first; the first that starts.
fn first_hardware_encoder() -> Result<(IMFActivate, IMFTransform, String)> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_H264,
    };
    let flags = MFT_ENUM_FLAG(MFT_ENUM_FLAG_HARDWARE.0 | MFT_ENUM_FLAG_SORTANDFILTER.0);
    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    // SAFETY: the type descriptions live for the call; the list it returns is read once
    // and freed.
    let found: Vec<IMFActivate> = unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            flags,
            Some(&input),
            Some(&output),
            &mut list,
            &mut count,
        )
        .context("listing the video encoders")?;
        if list.is_null() {
            Vec::new()
        } else {
            let found = std::slice::from_raw_parts_mut(list, count as usize)
                .iter_mut()
                .filter_map(Option::take)
                .collect();
            CoTaskMemFree(Some(list.cast()));
            found
        }
    };
    for activate in found {
        let name = friendly_name(&activate).unwrap_or_else(|| "a hardware encoder".to_owned());
        // SAFETY: the activation object is live.
        match unsafe { activate.ActivateObject::<IMFTransform>() } {
            Ok(transform) => return Ok((activate, transform, name)),
            Err(error) => debug!(%error, %name, "encoder did not start"),
        }
    }
    bail!("no hardware H.264 encoder on this computer")
}

fn friendly_name(activate: &IMFActivate) -> Option<String> {
    let mut text = PWSTR::null();
    let mut length = 0;
    // SAFETY: the string is read once and freed.
    unsafe {
        activate
            .GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut text, &mut length)
            .ok()?;
        let name = text.to_string().ok();
        CoTaskMemFree(Some(text.0.cast()));
        name
    }
}

fn empty_sample(capacity: u32) -> Result<IMFSample> {
    // SAFETY: new objects, joined together.
    unsafe {
        let buffer = MFCreateMemoryBuffer(capacity)?;
        let sample = MFCreateSample()?;
        sample.AddBuffer(&buffer)?;
        Ok(sample)
    }
}

fn read_sample(sample: &IMFSample) -> Result<Vec<u8>> {
    // SAFETY: the buffer is locked for exactly the copy.
    unsafe {
        let buffer = sample.ConvertToContiguousBuffer()?;
        let mut data = std::ptr::null_mut();
        let mut length = 0;
        buffer.Lock(&mut data, None, Some(&mut length))?;
        let bytes = std::slice::from_raw_parts(data, length as usize).to_vec();
        buffer.Unlock()?;
        Ok(bytes)
    }
}

/// Whether an Annex B access unit holds a NAL unit of `kind`.
fn has_nal(annex_b: &[u8], kind: u8) -> bool {
    annex_b
        .windows(4)
        .enumerate()
        .filter(|(_, window)| window[..3] == [0, 0, 1] || *window == [0, 0, 0, 1])
        .any(|(at, window)| {
            let header = if window[2] == 1 { at + 3 } else { at + 4 };
            annex_b.get(header).is_some_and(|byte| byte & 0x1f == kind)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nal_units_are_found_after_either_start_code() {
        let unit = [0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 1, 0x65, 4];
        assert!(has_nal(&unit, 7));
        assert!(has_nal(&unit, 8));
        assert!(has_nal(&unit, 5));
        assert!(!has_nal(&unit, 1));
    }

    /// Runs only where the machine has an encoder: CI runners have no graphics card, and
    /// the software path is what they then exercise.
    #[test]
    fn a_hardware_encoder_makes_a_keyframe_when_there_is_one() {
        let Ok(mut encoder) = HardwareEncoder::new((256, 144), 60, 2_000_000) else {
            return;
        };
        let picture = [40u8, 80, 120, 255].repeat(256 * 144);
        let mut units = Vec::new();
        for _ in 0..5 {
            units.extend(
                encoder
                    .encode(&picture, 256, 144, units.is_empty())
                    .unwrap(),
            );
        }
        let first = units.first().expect("some picture comes out");
        assert!(has_nal(first, SPS), "the first picture starts the stream");
    }
}
