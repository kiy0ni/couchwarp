//! Windows host backend: Windows Graphics Capture, OpenH264 (software, until the hardware
//! encoders land), VIIPER virtual controllers, SendInput for keys, WASAPI for sound.

pub mod capture;
pub mod encoder;
mod keyboard;
mod pads;
mod sound;

use couchwarp_protocol::input::GamepadState;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

use keyboard::KeyboardSink;
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
    pads: PadSink,
}

impl InputSink {
    pub fn new(_game_pid: i32) -> Self {
        Self {
            keyboard: KeyboardSink::default(),
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

    pub fn set_pad(&mut self, slot: u8, state: &GamepadState) {
        self.pads.set(slot, state);
    }

    pub fn release_pad(&mut self, slot: u8) {
        self.pads.release(slot);
    }
}
