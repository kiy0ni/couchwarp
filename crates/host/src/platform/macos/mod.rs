//! macOS host backend: ScreenCaptureKit, VideoToolbox, CoreGraphics events.
//!
//! macOS has no supported way for an app to create a virtual game controller (the
//! DriverKit entitlement is not granted to third parties), so controllers are received
//! and given slots but not played into the game. Keyboards are.

pub mod capture;
pub mod encoder;
mod keyboard;

use couchwarp_protocol::input::GamepadState;
use objc2_core_foundation::{CFArray, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_graphics::{
    CGMainDisplayID, CGPreflightPostEventAccess, CGRequestPostEventAccess,
    CGWindowListCopyWindowInfo, CGWindowListOption, kCGNullWindowID, kCGWindowLayer,
    kCGWindowOwnerPID,
};
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

/// The process that owns the frontmost window.
///
/// Read from the window list on every call. `NSWorkspace.frontmostApplication` would be
/// simpler, but a command-line tool has no AppKit run loop to refresh it: it keeps
/// answering whichever app was in front at launch.
pub fn frontmost_pid() -> Option<i32> {
    let windows = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements,
        kCGNullWindowID,
    )?;
    // SAFETY: the window list is documented as an array of dictionaries keyed by strings.
    let windows: CFRetained<CFArray<CFDictionary<CFString, CFType>>> =
        unsafe { CFRetained::cast_unchecked(windows) };
    // Front to back; layer 0 holds ordinary app windows, above it sit the menu bar,
    // the Dock and other system overlays.
    windows.iter().find_map(|window| {
        // SAFETY: Core Graphics exports these keys as constant strings.
        let (layer_key, pid_key) = unsafe { (kCGWindowLayer, kCGWindowOwnerPID) };
        (number(&window, layer_key)? == 0).then(|| number(&window, pid_key))?
    })
}

fn number(window: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<i32> {
    window.get(key)?.downcast::<CFNumber>().ok()?.as_i32()
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
