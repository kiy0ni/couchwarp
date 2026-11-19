//! A guest's controller state as an Xbox 360 controller report, the layout every
//! Windows game understands through XInput.

use couchwarp_protocol::input::{Buttons, GamepadState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct XboxReport {
    pub buttons: u32,
    pub left_trigger: u8,
    pub right_trigger: u8,
    pub left_stick: [i16; 2],
    pub right_stick: [i16; 2],
}

const BUTTONS: [(Buttons, u32); 15] = [
    (Buttons::DPAD_UP, 0x0001),
    (Buttons::DPAD_DOWN, 0x0002),
    (Buttons::DPAD_LEFT, 0x0004),
    (Buttons::DPAD_RIGHT, 0x0008),
    (Buttons::START, 0x0010),
    (Buttons::BACK, 0x0020),
    (Buttons::LEFT_STICK, 0x0040),
    (Buttons::RIGHT_STICK, 0x0080),
    (Buttons::LEFT_BUMPER, 0x0100),
    (Buttons::RIGHT_BUMPER, 0x0200),
    (Buttons::GUIDE, 0x0400),
    (Buttons::A, 0x1000),
    (Buttons::B, 0x2000),
    (Buttons::X, 0x4000),
    (Buttons::Y, 0x8000),
];

/// XInput counts stick Y upwards; the protocol, like the Gamepad API, counts it down.
fn flip(y: i16) -> i16 {
    y.checked_neg().unwrap_or(i16::MAX)
}

pub fn xbox_report(state: &GamepadState) -> XboxReport {
    let buttons = BUTTONS
        .iter()
        .filter(|(button, _)| state.buttons.contains(*button))
        .fold(0, |bits, (_, xinput)| bits | xinput);
    XboxReport {
        buttons,
        left_trigger: state.left_trigger,
        right_trigger: state.right_trigger,
        left_stick: [state.left_stick[0], flip(state.left_stick[1])],
        right_stick: [state.right_stick[0], flip(state.right_stick[1])],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_use_xinput_bits() {
        let state = GamepadState {
            buttons: Buttons(Buttons::A.0 | Buttons::START.0 | Buttons::DPAD_LEFT.0),
            ..GamepadState::default()
        };
        assert_eq!(xbox_report(&state).buttons, 0x1000 | 0x0010 | 0x0004);
    }

    #[test]
    fn stick_up_is_positive_for_xinput() {
        let state = GamepadState {
            left_stick: [100, -32767],
            right_stick: [0, i16::MIN],
            left_trigger: 255,
            ..GamepadState::default()
        };
        let report = xbox_report(&state);
        assert_eq!(report.left_stick, [100, 32767]);
        // -32768 has no positive twin in 16 bits; it becomes the top of the range.
        assert_eq!(report.right_stick, [0, 32767]);
        assert_eq!(report.left_trigger, 255);
    }
}
