//! Draws the pointer into a captured picture, for captures that leave it out (X11).

/// Blends a cursor, ARGB pixels with premultiplied alpha as X11 gives it, into a BGRA
/// picture with packed rows, its top-left corner at (`left`, `top`) in the picture. The
/// parts outside the picture are left out.
pub fn blend(
    bgra: &mut [u8],
    size: (usize, usize),
    cursor: &[u32],
    cursor_size: (usize, usize),
    left: i32,
    top: i32,
) {
    let (width, height) = size;
    let (cursor_width, cursor_height) = cursor_size;
    for row in 0..cursor_height {
        let Ok(y) = usize::try_from(top + row as i32) else {
            continue;
        };
        if y >= height {
            break;
        }
        for column in 0..cursor_width {
            let Ok(x) = usize::try_from(left + column as i32) else {
                continue;
            };
            if x >= width {
                break;
            }
            let Some(&argb) = cursor.get(row * cursor_width + column) else {
                return;
            };
            let alpha = argb >> 24;
            if alpha == 0 {
                continue;
            }
            let at = (y * width + x) * 4;
            for (channel, shift) in [(0, 0), (1, 8), (2, 16)] {
                let source = (argb >> shift) & 0xff;
                let below = u32::from(bgra[at + channel]);
                bgra[at + channel] = (source + below * (255 - alpha) / 255).min(255) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_pixels_replace_and_clear_ones_keep() {
        let mut picture = [10u8, 20, 30, 255].repeat(4);
        // A 2×1 cursor: opaque red, then fully clear.
        blend(
            &mut picture,
            (2, 2),
            &[0xffff_0000, 0x0000_0000],
            (2, 1),
            1,
            1,
        );
        assert_eq!(&picture[12..15], &[0, 0, 255], "red lands at (1, 1)");
        assert_eq!(
            &picture[..12],
            &[10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]
        );
    }

    #[test]
    fn half_clear_pixels_mix_with_the_picture() {
        let mut picture = [200u8, 200, 200, 255].to_vec();
        // White at half opacity, premultiplied.
        blend(&mut picture, (1, 1), &[0x8080_8080], (1, 1), 0, 0);
        assert_eq!(&picture[..3], &[227, 227, 227]);
    }

    #[test]
    fn a_cursor_off_the_edges_is_clipped() {
        let mut picture = [0u8; 4 * 4];
        blend(&mut picture, (2, 2), &[0xffff_ffff; 9], (3, 3), -2, 1);
        assert_eq!(&picture[8..11], &[255, 255, 255], "only (0, 1) is covered");
        assert_eq!(picture.iter().filter(|&&byte| byte == 255).count(), 3);
    }
}
