//! A guest's controller state as a DualShock 4 report, for games that expect a
//! PlayStation controller. Field layout: VIIPER's `dualshock4` device.

use couchwarp_protocol::input::{Buttons, GamepadState};

/// Above this, an analog trigger also counts as its digital button, as on the real pad.
const TRIGGER_PRESSED: u8 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Ds4Report {
    pub buttons: u16,
    pub dpad: u8,
    pub left_trigger: u8,
    pub right_trigger: u8,
    /// -128 to 127, Y counted downwards as the DualShock 4 does.
    pub left_stick: [i8; 2],
    pub right_stick: [i8; 2],
}

/// Face buttons by position: A is the bottom one (cross), Y the top one (triangle).
const BUTTONS: [(Buttons, u16); 11] = [
    (Buttons::GUIDE, 0x0001),
    (Buttons::X, 0x0010),
    (Buttons::A, 0x0020),
    (Buttons::B, 0x0040),
    (Buttons::Y, 0x0080),
    (Buttons::LEFT_BUMPER, 0x0100),
    (Buttons::RIGHT_BUMPER, 0x0200),
    (Buttons::BACK, 0x1000),
    (Buttons::START, 0x2000),
    (Buttons::LEFT_STICK, 0x4000),
    (Buttons::RIGHT_STICK, 0x8000),
];
const L2: u16 = 0x0400;
const R2: u16 = 0x0800;

const DPAD: [(Buttons, u8); 4] = [
    (Buttons::DPAD_UP, 0x01),
    (Buttons::DPAD_DOWN, 0x02),
    (Buttons::DPAD_LEFT, 0x04),
    (Buttons::DPAD_RIGHT, 0x08),
];

/// The protocol's 16-bit axis, down to the DualShock 4's 8 bits.
fn axis(value: i16) -> i8 {
    (value >> 8) as i8
}

pub fn ds4_report(state: &GamepadState) -> Ds4Report {
    let mut buttons = BUTTONS
        .iter()
        .filter(|(button, _)| state.buttons.contains(*button))
        .fold(0, |bits, (_, ds4)| bits | ds4);
    if state.left_trigger > TRIGGER_PRESSED {
        buttons |= L2;
    }
    if state.right_trigger > TRIGGER_PRESSED {
        buttons |= R2;
    }
    let dpad = DPAD
        .iter()
        .filter(|(button, _)| state.buttons.contains(*button))
        .fold(0, |bits, (_, ds4)| bits | ds4);
    Ds4Report {
        buttons,
        dpad,
        left_trigger: state.left_trigger,
        right_trigger: state.right_trigger,
        left_stick: [axis(state.left_stick[0]), axis(state.left_stick[1])],
        right_stick: [axis(state.right_stick[0]), axis(state.right_stick[1])],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn face_buttons_keep_their_position() {
        let state = GamepadState {
            buttons: Buttons(Buttons::A.0 | Buttons::Y.0 | Buttons::START.0),
            ..GamepadState::default()
        };
        // Cross, triangle, options.
        assert_eq!(ds4_report(&state).buttons, 0x0020 | 0x0080 | 0x2000);
    }

    #[test]
    fn diagonals_combine_and_triggers_press_their_buttons() {
        let state = GamepadState {
            buttons: Buttons(Buttons::DPAD_UP.0 | Buttons::DPAD_RIGHT.0),
            left_trigger: 200,
            right_trigger: 10,
            ..GamepadState::default()
        };
        let report = ds4_report(&state);
        assert_eq!(report.dpad, 0x01 | 0x08);
        assert_eq!(report.buttons, L2);
        assert_eq!((report.left_trigger, report.right_trigger), (200, 10));
    }

    #[test]
    fn sticks_scale_to_eight_bits_without_flipping() {
        let state = GamepadState {
            left_stick: [i16::MAX, i16::MIN],
            right_stick: [0, 256],
            ..GamepadState::default()
        };
        let report = ds4_report(&state);
        assert_eq!(report.left_stick, [127, -128]);
        assert_eq!(report.right_stick, [0, 1]);
    }
}
