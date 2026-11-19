//! Controller and keyboard state sent by guests on the unreliable `input` data channel.
//!
//! Every packet carries the *whole* state of one device, never a single key event.
//! A lost packet is replaced by the next one, so a key can never stay stuck down.
//! Packets may arrive out of order: receivers drop any packet whose `seq` is not
//! newer than the last one applied (see [`is_newer`]).
//!
//! All integers are little-endian.
//!
//! ```text
//! gamepad  (16 bytes): kind=1 | pad u8 | seq u16 | buttons u16 | lx ly rx ry i16 | lt rt u8
//! keyboard (4+n bytes): kind=2 | seq u16 | n u8 | n × HID usage u8
//! mouse    (10 bytes): kind=3 | seq u16 | buttons u8 | dx dy i16 | wheel i16
//! ```
//!
//! The mouse is the one exception to whole states: its movement is relative, counted
//! since the previous packet. Buttons are still a whole state, so a lost packet costs a
//! few pixels of movement but never leaves a button held.

use thiserror::Error;

/// Most keys a guest can hold at once. More than any real keyboard reports.
pub const MAX_KEYS: usize = 32;

/// Pad numbers 0 to 3 are physical controllers. The two virtual pads a guest can drive
/// without one come after them.
pub const KEYBOARD_PAD: u8 = 4;
pub const TOUCH_PAD: u8 = 5;

const KIND_GAMEPAD: u8 = 1;
const KIND_KEYBOARD: u8 = 2;
const KIND_MOUSE: u8 = 3;
const GAMEPAD_LEN: usize = 16;
const MOUSE_LEN: usize = 10;
const KEYBOARD_HEADER_LEN: usize = 4;

/// Digital buttons, one bit each, in the order of the W3C standard gamepad mapping
/// with the two analog triggers left out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Buttons(pub u16);

impl Buttons {
    pub const A: Self = Self(1 << 0);
    pub const B: Self = Self(1 << 1);
    pub const X: Self = Self(1 << 2);
    pub const Y: Self = Self(1 << 3);
    pub const LEFT_BUMPER: Self = Self(1 << 4);
    pub const RIGHT_BUMPER: Self = Self(1 << 5);
    pub const BACK: Self = Self(1 << 6);
    pub const START: Self = Self(1 << 7);
    pub const LEFT_STICK: Self = Self(1 << 8);
    pub const RIGHT_STICK: Self = Self(1 << 9);
    pub const DPAD_UP: Self = Self(1 << 10);
    pub const DPAD_DOWN: Self = Self(1 << 11);
    pub const DPAD_LEFT: Self = Self(1 << 12);
    pub const DPAD_RIGHT: Self = Self(1 << 13);
    /// The Xbox, PlayStation or Home button.
    pub const GUIDE: Self = Self(1 << 14);

    pub fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    pub fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }
}

/// One controller of one guest. Stick Y axes follow the Gamepad API: positive is down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct GamepadState {
    /// Controller on the guest's device: 0 to 3 for physical ones, then
    /// [`KEYBOARD_PAD`] and [`TOUCH_PAD`].
    pub pad: u8,
    pub seq: u16,
    pub buttons: Buttons,
    pub left_stick: [i16; 2],
    pub right_stick: [i16; 2],
    pub left_trigger: u8,
    pub right_trigger: u8,
}

/// Every key a guest holds, as USB HID usage IDs from the keyboard page (0x07).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct KeyboardState {
    pub seq: u16,
    pub keys: Vec<u8>,
}

/// Mouse buttons, one bit each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MouseButtons(pub u8);

impl MouseButtons {
    pub const LEFT: Self = Self(1 << 0);
    pub const RIGHT: Self = Self(1 << 1);
    pub const MIDDLE: Self = Self(1 << 2);
    pub const BACK: Self = Self(1 << 3);
    pub const FORWARD: Self = Self(1 << 4);

    pub fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

/// One guest's mouse: movement in pixels since the previous packet, wheel in 1/120ths
/// of a notch (positive scrolls down), buttons held now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MouseState {
    pub seq: u16,
    pub buttons: MouseButtons,
    pub dx: i16,
    pub dy: i16,
    pub wheel: i16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputPacket {
    Gamepad(GamepadState),
    Keyboard(KeyboardState),
    Mouse(MouseState),
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DecodeError {
    #[error("empty packet")]
    Empty,
    #[error("unknown packet kind {0}")]
    UnknownKind(u8),
    #[error("expected {expected} bytes, got {actual}")]
    Length { expected: usize, actual: usize },
    #[error("{0} keys held, the limit is {MAX_KEYS}")]
    TooManyKeys(usize),
}

/// Whether `seq` comes after `last`, allowing for the counter wrapping at 65535.
pub fn is_newer(seq: u16, last: u16) -> bool {
    (seq.wrapping_sub(last) as i16) > 0
}

impl InputPacket {
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Self::Gamepad(pad) => {
                let mut out = Vec::with_capacity(GAMEPAD_LEN);
                out.extend([KIND_GAMEPAD, pad.pad]);
                out.extend(pad.seq.to_le_bytes());
                out.extend(pad.buttons.0.to_le_bytes());
                for axis in pad.left_stick.iter().chain(&pad.right_stick) {
                    out.extend(axis.to_le_bytes());
                }
                out.extend([pad.left_trigger, pad.right_trigger]);
                out
            }
            Self::Keyboard(keyboard) => {
                let mut out = Vec::with_capacity(KEYBOARD_HEADER_LEN + keyboard.keys.len());
                out.push(KIND_KEYBOARD);
                out.extend(keyboard.seq.to_le_bytes());
                // Encoding more than MAX_KEYS would produce a packet every receiver rejects.
                out.push(keyboard.keys.len().min(MAX_KEYS) as u8);
                out.extend(keyboard.keys.iter().take(MAX_KEYS));
                out
            }
            Self::Mouse(mouse) => {
                let mut out = Vec::with_capacity(MOUSE_LEN);
                out.push(KIND_MOUSE);
                out.extend(mouse.seq.to_le_bytes());
                out.push(mouse.buttons.0);
                for value in [mouse.dx, mouse.dy, mouse.wheel] {
                    out.extend(value.to_le_bytes());
                }
                out
            }
        }
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        match bytes.first() {
            None => Err(DecodeError::Empty),
            Some(&KIND_GAMEPAD) => decode_gamepad(bytes).map(Self::Gamepad),
            Some(&KIND_KEYBOARD) => decode_keyboard(bytes).map(Self::Keyboard),
            Some(&KIND_MOUSE) => decode_mouse(bytes).map(Self::Mouse),
            Some(&kind) => Err(DecodeError::UnknownKind(kind)),
        }
    }
}

fn decode_gamepad(bytes: &[u8]) -> Result<GamepadState, DecodeError> {
    let bytes: &[u8; GAMEPAD_LEN] = bytes.try_into().map_err(|_| DecodeError::Length {
        expected: GAMEPAD_LEN,
        actual: bytes.len(),
    })?;
    let u16_at = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
    let i16_at = |i: usize| i16::from_le_bytes([bytes[i], bytes[i + 1]]);
    Ok(GamepadState {
        pad: bytes[1],
        seq: u16_at(2),
        buttons: Buttons(u16_at(4)),
        left_stick: [i16_at(6), i16_at(8)],
        right_stick: [i16_at(10), i16_at(12)],
        left_trigger: bytes[14],
        right_trigger: bytes[15],
    })
}

fn decode_mouse(bytes: &[u8]) -> Result<MouseState, DecodeError> {
    let bytes: &[u8; MOUSE_LEN] = bytes.try_into().map_err(|_| DecodeError::Length {
        expected: MOUSE_LEN,
        actual: bytes.len(),
    })?;
    let i16_at = |i: usize| i16::from_le_bytes([bytes[i], bytes[i + 1]]);
    Ok(MouseState {
        seq: u16::from_le_bytes([bytes[1], bytes[2]]),
        buttons: MouseButtons(bytes[3]),
        dx: i16_at(4),
        dy: i16_at(6),
        wheel: i16_at(8),
    })
}

fn decode_keyboard(bytes: &[u8]) -> Result<KeyboardState, DecodeError> {
    if bytes.len() < KEYBOARD_HEADER_LEN {
        return Err(DecodeError::Length {
            expected: KEYBOARD_HEADER_LEN,
            actual: bytes.len(),
        });
    }
    let count = usize::from(bytes[3]);
    if count > MAX_KEYS {
        return Err(DecodeError::TooManyKeys(count));
    }
    let expected = KEYBOARD_HEADER_LEN + count;
    if bytes.len() != expected {
        return Err(DecodeError::Length {
            expected,
            actual: bytes.len(),
        });
    }
    Ok(KeyboardState {
        seq: u16::from_le_bytes([bytes[1], bytes[2]]),
        keys: bytes[KEYBOARD_HEADER_LEN..].to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequence_numbers_wrap_around() {
        assert!(is_newer(1, 0));
        assert!(is_newer(0, 65535));
        assert!(is_newer(10, 65530));
        assert!(!is_newer(5, 5));
        assert!(!is_newer(65530, 10));
    }

    #[test]
    fn keyboard_with_too_many_keys_is_rejected() {
        let mut bytes = vec![KIND_KEYBOARD, 0, 0, MAX_KEYS as u8 + 1];
        bytes.extend([4; MAX_KEYS + 1]);
        assert_eq!(
            InputPacket::decode(&bytes),
            Err(DecodeError::TooManyKeys(MAX_KEYS + 1))
        );
    }

    #[test]
    fn encoding_caps_the_key_count() {
        let packet = InputPacket::Keyboard(KeyboardState {
            seq: 1,
            keys: vec![4; MAX_KEYS + 5],
        });
        let decoded = InputPacket::decode(&packet.encode()).unwrap();
        let InputPacket::Keyboard(keyboard) = decoded else {
            panic!("expected a keyboard packet");
        };
        assert_eq!(keyboard.keys.len(), MAX_KEYS);
    }

    #[test]
    fn buttons_can_be_removed() {
        let held = Buttons(Buttons::A.0 | Buttons::GUIDE.0);
        assert!(held.contains(Buttons::GUIDE));
        assert_eq!(held.without(Buttons::GUIDE), Buttons::A);
    }
}
