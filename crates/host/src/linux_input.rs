//! Guests' controllers and mice as Linux input events, the codes `uinput` devices send.
//! A controller shows up as an Xbox 360 pad laid out like the kernel's own `xpad` driver,
//! so games, SDL and Steam read it as a wired Xbox controller.
//!
//! Codes come from `linux/input-event-codes.h`.

use couchwarp_protocol::input::{Buttons, GamepadState, MouseButtons};

pub const EV_KEY: u16 = 0x01;
pub const EV_REL: u16 = 0x02;
pub const EV_ABS: u16 = 0x03;

pub const REL_X: u16 = 0x00;
pub const REL_Y: u16 = 0x01;
pub const REL_WHEEL: u16 = 0x08;
pub const REL_WHEEL_HI_RES: u16 = 0x0b;

pub const ABS_X: u16 = 0x00;
pub const ABS_Y: u16 = 0x01;
/// The left trigger, as `xpad` reports it.
pub const ABS_Z: u16 = 0x02;
pub const ABS_RX: u16 = 0x03;
pub const ABS_RY: u16 = 0x04;
/// The right trigger.
pub const ABS_RZ: u16 = 0x05;
pub const ABS_HAT0X: u16 = 0x10;
pub const ABS_HAT0Y: u16 = 0x11;

/// The identity of a wired Xbox 360 controller: vendor, product, version.
pub const XBOX_360_ID: (u16, u16, u16) = (0x045e, 0x028e, 0x0110);

/// Face and shoulder buttons. `xpad` reports the X and Y buttons as `BTN_X` and `BTN_Y`,
/// whatever their place on the pad, and SDL's mappings expect that.
pub const PAD_BUTTONS: [(Buttons, u16); 11] = [
    (Buttons::A, 0x130),            // BTN_A
    (Buttons::B, 0x131),            // BTN_B
    (Buttons::X, 0x133),            // BTN_X
    (Buttons::Y, 0x134),            // BTN_Y
    (Buttons::LEFT_BUMPER, 0x136),  // BTN_TL
    (Buttons::RIGHT_BUMPER, 0x137), // BTN_TR
    (Buttons::BACK, 0x13a),         // BTN_SELECT
    (Buttons::START, 0x13b),        // BTN_START
    (Buttons::GUIDE, 0x13c),        // BTN_MODE
    (Buttons::LEFT_STICK, 0x13d),   // BTN_THUMBL
    (Buttons::RIGHT_STICK, 0x13e),  // BTN_THUMBR
];

pub const MOUSE_BUTTONS: [(MouseButtons, u16); 5] = [
    (MouseButtons::LEFT, 0x110),    // BTN_LEFT
    (MouseButtons::RIGHT, 0x111),   // BTN_RIGHT
    (MouseButtons::MIDDLE, 0x112),  // BTN_MIDDLE
    (MouseButtons::BACK, 0x113),    // BTN_SIDE
    (MouseButtons::FORWARD, 0x114), // BTN_EXTRA
];

/// One event: type, code, value. The kernel drops values that did not change, so a
/// controller can send its whole state every time.
pub type Event = (u16, u16, i32);

/// The whole state of one controller. Stick Y counts downwards, as in the protocol.
pub fn pad_events(state: &GamepadState) -> Vec<Event> {
    let pressed = |button| i32::from(state.buttons.contains(button));
    let mut events: Vec<Event> = PAD_BUTTONS
        .iter()
        .map(|&(button, code)| (EV_KEY, code, pressed(button)))
        .collect();
    events.extend([
        (EV_ABS, ABS_X, i32::from(state.left_stick[0])),
        (EV_ABS, ABS_Y, i32::from(state.left_stick[1])),
        (EV_ABS, ABS_RX, i32::from(state.right_stick[0])),
        (EV_ABS, ABS_RY, i32::from(state.right_stick[1])),
        (EV_ABS, ABS_Z, i32::from(state.left_trigger)),
        (EV_ABS, ABS_RZ, i32::from(state.right_trigger)),
        (
            EV_ABS,
            ABS_HAT0X,
            pressed(Buttons::DPAD_RIGHT) - pressed(Buttons::DPAD_LEFT),
        ),
        (
            EV_ABS,
            ABS_HAT0Y,
            pressed(Buttons::DPAD_DOWN) - pressed(Buttons::DPAD_UP),
        ),
    ]);
    events
}

/// The code of one mouse button.
pub fn mouse_button_code(button: MouseButtons) -> Option<u16> {
    MOUSE_BUTTONS
        .iter()
        .find(|(candidate, _)| *candidate == button)
        .map(|&(_, code)| code)
}

/// Turns the protocol's wheel (1/120ths of a notch, positive down) into Linux's: fine
/// steps for programs that read them, whole notches for the rest. Linux counts up.
#[derive(Default)]
pub struct Wheel {
    pending: i32,
}

impl Wheel {
    pub fn scroll(&mut self, wheel: i32) -> Vec<Event> {
        let up = wheel.saturating_neg();
        self.pending = self.pending.saturating_add(up);
        let notches = self.pending / 120;
        self.pending -= notches * 120;
        let mut events = vec![(EV_REL, REL_WHEEL_HI_RES, up)];
        if notches != 0 {
            events.push((EV_REL, REL_WHEEL, notches));
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_controller_reads_like_xpad() {
        let state = GamepadState {
            buttons: Buttons(Buttons::A.0 | Buttons::DPAD_UP.0 | Buttons::DPAD_RIGHT.0),
            left_stick: [-32768, 32767],
            right_trigger: 200,
            ..GamepadState::default()
        };
        let events = pad_events(&state);
        let value = |kind, code| {
            events
                .iter()
                .find(|&&(t, c, _)| t == kind && c == code)
                .map(|&(_, _, v)| v)
        };
        assert_eq!(value(EV_KEY, 0x130), Some(1)); // A held
        assert_eq!(value(EV_KEY, 0x131), Some(0)); // B released
        // Down is positive on both sides: no flip, unlike XInput.
        assert_eq!(value(EV_ABS, ABS_Y), Some(32767));
        assert_eq!(value(EV_ABS, ABS_X), Some(-32768));
        assert_eq!(value(EV_ABS, ABS_RZ), Some(200));
        assert_eq!(value(EV_ABS, ABS_HAT0X), Some(1));
        assert_eq!(value(EV_ABS, ABS_HAT0Y), Some(-1));
    }

    #[test]
    fn mouse_buttons_have_codes() {
        assert_eq!(mouse_button_code(MouseButtons::LEFT), Some(0x110));
        assert_eq!(mouse_button_code(MouseButtons::FORWARD), Some(0x114));
        assert_eq!(mouse_button_code(MouseButtons(0)), None);
    }

    #[test]
    fn the_wheel_sends_notches_once_they_add_up() {
        let mut wheel = Wheel::default();
        // Half a notch down: fine step only.
        assert_eq!(wheel.scroll(60), [(EV_REL, REL_WHEEL_HI_RES, -60)]);
        // The other half completes one notch.
        assert_eq!(
            wheel.scroll(60),
            [(EV_REL, REL_WHEEL_HI_RES, -60), (EV_REL, REL_WHEEL, -1)]
        );
        assert_eq!(
            wheel.scroll(-240),
            [(EV_REL, REL_WHEEL_HI_RES, 240), (EV_REL, REL_WHEEL, 2)]
        );
    }
}
