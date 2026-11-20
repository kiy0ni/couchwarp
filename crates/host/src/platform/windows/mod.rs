//! Windows host backend: Windows Graphics Capture, OpenH264 (software, until the hardware
//! encoders land), VIIPER virtual controllers, SendInput for keys, WASAPI for sound.

pub mod capture;
pub mod encoder;
mod keyboard;
mod mouse;
mod pads;
mod sound;

use couchwarp_protocol::input::{GamepadState, MotionState, MouseButtons};
use couchwarp_protocol::room::PadType;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

use keyboard::KeyboardSink;
use mouse::MouseSink;
use pads::PadSink;

/// SendInput types into whatever window is in front, so the focus lock must stay on.
pub const KEYS_REACH_GAME_ONLY: bool = false;

/// Nothing to set up on Windows; kept so both backends start the same way.
pub fn init() {}

/// SendInput needs no permission.
pub fn can_send_keys() -> bool {
    true
}

pub fn frontmost_pid() -> Option<i32> {
    let mut pid = 0u32;
    // SAFETY: plain Win32 queries; `pid` outlives the call.
    unsafe {
        let window = GetForegroundWindow();
        if window.is_invalid() {
            return None;
        }
        GetWindowThreadProcessId(window, Some(&mut pid));
    }
    (pid != 0).then_some(pid as i32)
}

/// Where guests' input ends up on this machine.
pub struct InputSink {
    keyboard: KeyboardSink,
    mouse: MouseSink,
    pads: PadSink,
}

impl InputSink {
    pub fn new(_game_pid: i32) -> Self {
        Self {
            keyboard: KeyboardSink::default(),
            mouse: MouseSink::default(),
            pads: PadSink::connect(),
        }
    }

    /// True when the VIIPER service answered at startup.
    pub fn virtual_pads(&self) -> bool {
        self.pads.available()
    }

    pub fn set_keys(&mut self, keys: &[u8]) {
        self.keyboard.set_keys(keys);
    }

    pub fn set_pad(&mut self, slot: u8, pad_type: PadType, state: &GamepadState) {
        self.pads.set(slot, pad_type, state);
    }

    pub fn release_pad(&mut self, slot: u8) {
        self.pads.release(slot);
    }

    pub fn set_motion(&mut self, slot: u8, motion: &MotionState) {
        self.pads.set_motion(slot, motion);
    }

    pub fn move_mouse(&mut self, dx: i32, dy: i32) {
        self.mouse.move_by(dx, dy);
    }

    pub fn set_mouse_buttons(&mut self, buttons: MouseButtons) {
        self.mouse.set_buttons(buttons);
    }

    pub fn scroll(&mut self, wheel: i32) {
        self.mouse.scroll(wheel);
    }

    /// The game went behind: the cursor is set free at once.
    pub fn set_paused(&mut self, paused: bool) {
        if paused {
            self.mouse.release();
        }
    }
}
