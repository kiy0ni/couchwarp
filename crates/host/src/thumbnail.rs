//! Small pictures of the game for the public room list: one every few seconds, only while
//! the room is listed, scaled down and compressed as JPEG on the capture thread.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::Result;
use jpeg_encoder::{ColorType, Encoder};
use tokio::sync::mpsc;
use tracing::warn;

/// Width of the pictures; the height keeps the window's proportions.
const WIDTH: usize = 320;
const EVERY: Duration = Duration::from_secs(10);
const QUALITY: u8 = 70;

pub struct Thumbnails {
    wanted: AtomicBool,
    next_at: Mutex<Instant>,
    out: mpsc::Sender<Vec<u8>>,
}

impl Thumbnails {
    /// Pictures go to `out`; one waiting is enough, newer ones are dropped meanwhile.
    pub fn new(out: mpsc::Sender<Vec<u8>>) -> Self {
        Self {
            wanted: AtomicBool::new(false),
            next_at: Mutex::new(Instant::now()),
            out,
        }
    }

    /// Pictures are taken only while the room is listed publicly. Listing it takes one
    /// on the next frame.
    pub fn set_wanted(&self, wanted: bool) {
        if wanted && !self.wanted.swap(true, Ordering::AcqRel) {
            *self.next_at.lock().expect("never poisoned") = Instant::now();
        } else if !wanted {
            self.wanted.store(false, Ordering::Release);
        }
    }

    /// Whether this frame should become a picture. Cheap: called on every frame.
    pub fn due(&self) -> bool {
        if !self.wanted.load(Ordering::Acquire) {
            return false;
        }
        let mut next_at = self.next_at.lock().expect("never poisoned");
        let now = Instant::now();
        if now < *next_at {
            return false;
        }
        *next_at = now + EVERY;
        true
    }

    /// Takes a picture from an NV12 frame (video range, BT.709), as macOS captures.
    pub fn send_nv12(&self, frame: &Nv12<'_>) {
        let (rgb, width, height) = downscale(frame.width, frame.height, |area| frame.rgb(area));
        self.send(&rgb, width, height);
    }

    /// Takes a picture from a BGRA frame with packed rows, as Windows captures.
    #[cfg(any(windows, test))]
    pub fn send_bgra(&self, bgra: &[u8], width: usize, height: usize) {
        let (rgb, small_width, small_height) = downscale(width, height, |area| {
            average(area, |x, y| {
                let pixel = &bgra[(y * width + x) * 4..][..3];
                [pixel[2], pixel[1], pixel[0]]
            })
        });
        self.send(&rgb, small_width, small_height);
    }

    fn send(&self, rgb: &[u8], width: usize, height: usize) {
        match jpeg(rgb, width, height) {
            // A full queue means the last picture is still on its way: skip this one.
            Ok(picture) => {
                let _ = self.out.try_send(picture);
            }
            Err(error) => warn!(%error, "room picture not encoded"),
        }
    }
}

/// One NV12 frame: a full-size luma plane, then a half-size plane of interleaved U and V.
pub struct Nv12<'a> {
    pub width: usize,
    pub height: usize,
    pub luma: &'a [u8],
    pub luma_stride: usize,
    pub chroma: &'a [u8],
    pub chroma_stride: usize,
}

impl Nv12<'_> {
    /// Average colour of `area`, converted from video-range BT.709.
    fn rgb(&self, area: Area) -> [u8; 3] {
        let luma = average_channel(area, |x, y| self.luma[y * self.luma_stride + x]);
        let half = Area {
            x0: area.x0 / 2,
            y0: area.y0 / 2,
            x1: area.x1.div_ceil(2),
            y1: area.y1.div_ceil(2),
        };
        let u = average_channel(half, |x, y| self.chroma[y * self.chroma_stride + 2 * x]);
        let v = average_channel(half, |x, y| self.chroma[y * self.chroma_stride + 2 * x + 1]);
        let (y, u, v) = (1.164 * (luma - 16.0), u - 128.0, v - 128.0);
        [
            clamp(y + 1.793 * v),
            clamp(y - 0.213 * u - 0.533 * v),
            clamp(y + 2.112 * u),
        ]
    }
}

/// A block of source pixels, `x0..x1` by `y0..y1`.
#[derive(Debug, Clone, Copy)]
struct Area {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
}

/// Scales a `width` by `height` frame down to `WIDTH` pixels wide, each output pixel the
/// colour `colour` gives for its block of the source. Returns RGB bytes and the new size.
fn downscale(
    width: usize,
    height: usize,
    colour: impl Fn(Area) -> [u8; 3],
) -> (Vec<u8>, usize, usize) {
    let small_width = WIDTH.min(width).max(1);
    let small_height = (height * small_width / width.max(1)).max(1);
    let mut rgb = Vec::with_capacity(small_width * small_height * 3);
    for row in 0..small_height {
        let y0 = row * height / small_height;
        let y1 = ((row + 1) * height / small_height).max(y0 + 1);
        for column in 0..small_width {
            let x0 = column * width / small_width;
            let x1 = ((column + 1) * width / small_width).max(x0 + 1);
            rgb.extend_from_slice(&colour(Area { x0, y0, x1, y1 }));
        }
    }
    (rgb, small_width, small_height)
}

fn average(area: Area, pixel: impl Fn(usize, usize) -> [u8; 3]) -> [u8; 3] {
    let mut sum = [0u32; 3];
    for y in area.y0..area.y1 {
        for x in area.x0..area.x1 {
            for (total, value) in sum.iter_mut().zip(pixel(x, y)) {
                *total += u32::from(value);
            }
        }
    }
    let count = ((area.x1 - area.x0) * (area.y1 - area.y0)) as u32;
    sum.map(|total| (total / count) as u8)
}

fn average_channel(area: Area, value: impl Fn(usize, usize) -> u8) -> f32 {
    average(area, |x, y| [value(x, y), 0, 0])[0].into()
}

fn clamp(value: f32) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

fn jpeg(rgb: &[u8], width: usize, height: usize) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    Encoder::new(&mut out, QUALITY).encode(
        rgb,
        u16::try_from(width)?,
        u16::try_from(height)?,
        ColorType::Rgb,
    )?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thumbnails() -> (Thumbnails, mpsc::Receiver<Vec<u8>>) {
        let (out, pictures) = mpsc::channel(1);
        (Thumbnails::new(out), pictures)
    }

    #[test]
    fn pictures_come_only_while_listed_and_not_too_often() {
        let (thumbnails, _pictures) = thumbnails();
        assert!(!thumbnails.due());
        thumbnails.set_wanted(true);
        assert!(thumbnails.due());
        assert!(!thumbnails.due());
        thumbnails.set_wanted(false);
        thumbnails.set_wanted(true);
        assert!(thumbnails.due(), "listing again takes a picture at once");
    }

    #[test]
    fn a_frame_becomes_a_small_jpeg() {
        let (thumbnails, mut pictures) = thumbnails();
        let (width, height) = (1280, 720);
        let mut bgra = vec![0u8; width * height * 4];
        for pixel in bgra.as_chunks_mut::<4>().0 {
            pixel.copy_from_slice(&[255, 0, 0, 255]);
        }
        thumbnails.send_bgra(&bgra, width, height);
        let picture = pictures.try_recv().expect("a picture");
        assert_eq!(&picture[..3], &[0xff, 0xd8, 0xff]);
        assert!(picture.len() < 128 * 1024);
    }

    #[test]
    fn scaling_keeps_proportions_and_averages_blocks() {
        let (rgb, width, height) = downscale(1920, 1080, |area| {
            average(area, |x, _| {
                if x % 2 == 0 {
                    [0, 0, 0]
                } else {
                    [200, 100, 50]
                }
            })
        });
        assert_eq!((width, height), (320, 180));
        assert_eq!(&rgb[..3], &[100, 50, 25]);
    }

    #[test]
    fn video_range_white_and_black_convert() {
        let luma = [235u8; 4];
        let chroma = [128u8; 2];
        let frame = Nv12 {
            width: 2,
            height: 2,
            luma: &luma,
            luma_stride: 2,
            chroma: &chroma,
            chroma_stride: 2,
        };
        let full = Area {
            x0: 0,
            y0: 0,
            x1: 2,
            y1: 2,
        };
        assert_eq!(frame.rgb(full), [255, 255, 255]);
        let black = [16u8; 4];
        assert_eq!(
            Nv12 {
                luma: &black,
                ..frame
            }
            .rgb(full),
            [0, 0, 0]
        );
    }
}
