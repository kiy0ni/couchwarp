//! macOS host backend: ScreenCaptureKit, VideoToolbox, CoreGraphics events.
//!
//! macOS has no supported way for an app to create a virtual game controller (the
//! DriverKit entitlement is not granted to third parties), so controllers are received
//! and given slots but not played into the game. Keyboards are.

pub mod capture;
pub mod encoder;
mod keyboard;

use couchwarp_protocol::input::GamepadState;
use objc2_app_kit::NSWorkspace;
use objc2_core_graphics::{CGMainDisplayID, CGPreflightPostEventAccess, CGRequestPostEventAccess};
use tracing::warn;

use keyboard::KeyboardSink;

/// Command-line tools must touch CoreGraphics once before ScreenCaptureKit can run.
pub fn init() {
    CGMainDisplayID();
}

/// Whether this process may send key events. Asks the user the first time.
pub fn can_send_keys() -> bool {
    CGPreflightPostEventAccess() || CGRequestPostEventAccess()
}

pub fn frontmost_pid() -> Option<i32> {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|app| app.processIdentifier())
}

/// Where guests' input ends up on this machine.
pub struct InputSink {
    keyboard: KeyboardSink,
    warned_about_pads: bool,
}

impl InputSink {
    pub fn new(game_pid: i32) -> Self {
        Self {
            keyboard: KeyboardSink::new(game_pid),
            warned_about_pads: false,
        }
    }

    pub fn set_keys(&mut self, keys: &[u8]) {
        self.keyboard.set_keys(keys);
    }

    pub fn set_pad(&mut self, slot: u8, _state: &GamepadState) {
        if !self.warned_about_pads {
            self.warned_about_pads = true;
            warn!(
                slot,
                "controllers cannot be played into games on a macOS host; use a Windows or Linux host"
            );
        }
    }

    pub fn release_pad(&mut self, _slot: u8) {}
}
