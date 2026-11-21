//! BGRA pictures to NV12, the layout hardware H.264 encoders take: a full-size plane of
//! brightness, then one plane of colour at half size with blue and red interleaved. BT.601
//! limited range, as OpenH264 converts.

/// Converts the top-left even-sized part of a BGRA picture `width` pixels wide with packed
/// rows into `out`, which is resized to fit. Returns the size converted.
pub fn from_bgra(bgra: &[u8], width: usize, height: usize, out: &mut Vec<u8>) -> (usize, usize) {
    let (w, h) = (width & !1, height & !1);
    out.resize(w * h * 3 / 2, 0);
    let (luma, chroma) = out.split_at_mut(w * h);
    let stride = width * 4;
    for y in (0..h).step_by(2) {
        let rows = [&bgra[y * stride..], &bgra[(y + 1) * stride..]];
        for x in (0..w).step_by(2) {
            let mut sum = [0i32; 3];
            for (dy, row) in rows.iter().enumerate() {
                for dx in 0..2 {
                    let pixel = &row[(x + dx) * 4..];
                    let (b, g, r) = (
                        i32::from(pixel[0]),
                        i32::from(pixel[1]),
                        i32::from(pixel[2]),
                    );
                    luma[(y + dy) * w + x + dx] = brightness(r, g, b);
                    sum[0] += r;
                    sum[1] += g;
                    sum[2] += b;
                }
            }
            let [r, g, b] = sum.map(|total| (total + 2) / 4);
            let at = (y / 2) * w + x;
            chroma[at] = clamp(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
            chroma[at + 1] = clamp(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
        }
    }
    (w, h)
}

fn brightness(r: i32, g: i32, b: i32) -> u8 {
    clamp(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16)
}

fn clamp(value: i32) -> u8 {
    value.clamp(0, 255) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(width: usize, height: usize, bgra: [u8; 4]) -> Vec<u8> {
        bgra.repeat(width * height)
    }

    #[test]
    fn black_white_and_grey_are_colourless() {
        for (shade, expected) in [(0, 16), (255, 235), (128, 126)] {
            let mut out = Vec::new();
            let size = from_bgra(&picture(4, 2, [shade, shade, shade, 255]), 4, 2, &mut out);
            assert_eq!(size, (4, 2));
            assert_eq!(out.len(), 12);
            assert!(out[..8].iter().all(|&y| y == expected), "{out:?}");
            assert!(out[8..].iter().all(|&c| c == 128), "{out:?}");
        }
    }

    #[test]
    fn red_has_red_colour() {
        let mut out = Vec::new();
        from_bgra(&picture(2, 2, [0, 0, 255, 255]), 2, 2, &mut out);
        assert_eq!(out[..4], [82; 4]);
        // Blue difference below the middle, red difference near the top.
        assert_eq!(&out[4..], &[90, 240]);
    }

    #[test]
    fn odd_sizes_lose_their_last_row_and_column() {
        let mut out = Vec::new();
        assert_eq!(
            from_bgra(&picture(5, 3, [9, 9, 9, 255]), 5, 3, &mut out),
            (4, 2)
        );
        assert_eq!(out.len(), 12);
    }
}
