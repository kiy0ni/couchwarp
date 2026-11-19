//! H.264 as Apple's encoders produce it (NAL units after length prefixes, "AVCC"),
//! turned into Annex B (NAL units after start codes), the form str0m sends.

const START_CODE: [u8; 4] = [0, 0, 0, 1];
const NAL_TYPE_IDR: u8 = 5;

#[derive(Debug, PartialEq, Eq)]
pub struct MalformedNal;

/// The NAL units of `avcc`: each one prefixed by its big-endian length on `length_size`
/// bytes, the format encoders on Apple platforms produce.
fn nal_units(avcc: &[u8], length_size: usize) -> impl Iterator<Item = Result<&[u8], MalformedNal>> {
    let mut rest = avcc;
    std::iter::from_fn(move || {
        if rest.is_empty() {
            return None;
        }
        let unit = rest
            .split_at_checked(length_size)
            .and_then(|(length, after)| {
                let length = length
                    .iter()
                    .fold(0usize, |acc, &byte| (acc << 8) | usize::from(byte));
                after.split_at_checked(length)
            });
        match unit {
            Some((nal, after)) => {
                rest = after;
                Some(Ok(nal))
            }
            None => {
                rest = &[];
                Some(Err(MalformedNal))
            }
        }
    })
}

/// Whether `avcc` holds an IDR slice, the start of a picture that decodes on its own.
pub fn has_idr_slice(avcc: &[u8], length_size: usize) -> bool {
    nal_units(avcc, length_size)
        .map_while(Result::ok)
        .any(|nal| {
            nal.first()
                .is_some_and(|header| header & 0x1f == NAL_TYPE_IDR)
        })
}

/// Appends the NAL units of `avcc` to `out` in Annex B form.
pub fn append_annex_b(
    avcc: &[u8],
    length_size: usize,
    out: &mut Vec<u8>,
) -> Result<(), MalformedNal> {
    for nal in nal_units(avcc, length_size) {
        out.extend(START_CODE);
        out.extend(nal?);
    }
    Ok(())
}

/// Appends one parameter set (SPS or PPS) with its start code.
pub fn append_parameter_set(parameter_set: &[u8], out: &mut Vec<u8>) {
    out.extend(START_CODE);
    out.extend(parameter_set);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn length_prefixes_become_start_codes() {
        let avcc = [0, 0, 0, 2, 0x65, 0xaa, 0, 0, 0, 1, 0x41];
        let mut out = Vec::new();
        append_annex_b(&avcc, 4, &mut out).unwrap();
        assert_eq!(out, [0, 0, 0, 1, 0x65, 0xaa, 0, 0, 0, 1, 0x41]);
    }

    #[test]
    fn short_length_prefixes_are_read_too() {
        let mut out = Vec::new();
        append_annex_b(&[0, 1, 0x09], 2, &mut out).unwrap();
        assert_eq!(out, [0, 0, 0, 1, 0x09]);
    }

    #[test]
    fn a_length_past_the_end_is_rejected() {
        let mut out = Vec::new();
        assert_eq!(
            append_annex_b(&[0, 0, 0, 9, 0x65], 4, &mut out),
            Err(MalformedNal)
        );
        assert_eq!(append_annex_b(&[0, 0], 4, &mut out), Err(MalformedNal));
    }

    #[test]
    fn finds_the_idr_slice() {
        let access_unit = [0, 0, 0, 1, 0x09, 0, 0, 0, 2, 0x65, 0x88];
        assert!(has_idr_slice(&access_unit, 4));
        let delta = [0, 0, 0, 2, 0x41, 0x9a];
        assert!(!has_idr_slice(&delta, 4));
        assert!(!has_idr_slice(&[0, 0, 0, 9, 0x65], 4));
    }
}
