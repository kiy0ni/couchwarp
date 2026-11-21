//! macOS host backend: ScreenCaptureKit, VideoToolbox, CoreGraphics events.
//!
//! macOS has no supported way for an app to create a virtual game controller (the
//! DriverKit entitlement is not granted to third parties), so controllers are received
//! and given slots but not played into the game. Keyboards are.

pub mod capture;
pub mod encoder;
mod keyboard;
mod mouse;

use couchwarp_protocol::input::{GamepadState, MotionState, MouseButtons};
use couchwarp_protocol::room::PadType;
use objc2_core_foundation::{
    CFArray, CFDictionary, CFNumber, CFRetained, CFString, CFType, CGRect,
};
use objc2_core_graphics::{
    CGMainDisplayID, CGPreflightPostEventAccess, CGRectMakeWithDictionaryRepresentation,
    CGRequestPostEventAccess, CGRequestScreenCaptureAccess, CGWindowListCopyWindowInfo,
    CGWindowListOption, kCGNullWindowID, kCGWindowBounds, kCGWindowLayer, kCGWindowOwnerPID,
};
use tracing::warn;

use keyboard::KeyboardSink;
use mouse::MouseSink;

/// Keys are posted to the game process alone, so they cannot reach another app even
/// with the focus lock off.
pub const KEYS_REACH_GAME_ONLY: bool = true;

/// Command-line tools must touch CoreGraphics once before ScreenCaptureKit can run.
pub fn init() {
    CGMainDisplayID();
}

/// Whether this process may send key and mouse events to other apps, without asking.
pub fn input_allowed() -> bool {
    CGPreflightPostEventAccess()
}

/// Shows the system's request for Accessibility, which macOS shows once per app version.
pub fn ask_input_permission() {
    CGRequestPostEventAccess();
}

/// Shows the system's request for screen recording, as for Accessibility.
pub fn ask_screen_permission() {
    CGRequestScreenCaptureAccess();
}

/// The on-screen windows, front to back.
fn on_screen_windows() -> Option<CFRetained<CFArray<CFDictionary<CFString, CFType>>>> {
    let windows = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements,
        kCGNullWindowID,
    )?;
    // SAFETY: the window list is documented as an array of dictionaries keyed by strings.
    Some(unsafe { CFRetained::cast_unchecked(windows) })
}

/// The bounds, in global points, of the largest ordinary window of process `pid`.
fn window_bounds(pid: i32) -> Option<CGRect> {
    // SAFETY: Core Graphics exports these keys as constant strings.
    let (layer_key, pid_key, bounds_key) =
        unsafe { (kCGWindowLayer, kCGWindowOwnerPID, kCGWindowBounds) };
    on_screen_windows()?
        .iter()
        .filter(|window| {
            number(window, layer_key) == Some(0) && number(window, pid_key) == Some(pid)
        })
        .filter_map(|window| {
            let bounds = window.get(bounds_key)?.downcast::<CFDictionary>().ok()?;
            let mut rect = CGRect::default();
            // SAFETY: the value is a bounds dictionary; `rect` is valid for the write.
            unsafe { CGRectMakeWithDictionaryRepresentation(Some(&bounds), &mut rect) }
                .then_some(rect)
        })
        .max_by(|a, b| (a.size.width * a.size.height).total_cmp(&(b.size.width * b.size.height)))
}

/// The process that owns the frontmost window.
///
/// Read from the window list on every call. `NSWorkspace.frontmostApplication` would be
/// simpler, but a command-line tool has no AppKit run loop to refresh it: it keeps
/// answering whichever app was in front at launch.
pub fn frontmost_pid() -> Option<i32> {
    let windows = on_screen_windows()?;
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
    mouse: MouseSink,
    warned_about_pads: bool,
}

impl InputSink {
    pub fn new(game_pid: i32) -> Self {
        Self {
            keyboard: KeyboardSink::new(game_pid),
            mouse: MouseSink::new(game_pid),
            warned_about_pads: false,
        }
    }

    /// The game came back as another process: keys and clicks go to it from now on.
    pub fn set_game(&mut self, game_pid: i32) {
        self.keyboard.set_keys(&[]);
        self.mouse.set_buttons(MouseButtons(0));
        self.keyboard = KeyboardSink::new(game_pid);
        self.mouse = MouseSink::new(game_pid);
    }

    /// Whether guests' controllers reach the game. Never on macOS.
    pub fn virtual_pads(&self) -> bool {
        false
    }

    pub fn set_keys(&mut self, keys: &[u8]) {
        self.keyboard.set_keys(keys);
    }

    pub fn set_pad(&mut self, slot: u8, _pad_type: PadType, _state: &GamepadState) {
        if !self.warned_about_pads {
            self.warned_about_pads = true;
            warn!(
                slot,
                "controllers cannot be played into games on a macOS host; use a Windows or Linux host"
            );
        }
    }

    pub fn release_pad(&mut self, _slot: u8) {}

    /// No virtual controller on a Mac, so nothing reads motion either.
    pub fn set_motion(&mut self, _slot: u8, _motion: &MotionState) {}

    pub fn move_mouse(&mut self, dx: i32, dy: i32) {
        self.mouse.move_by(dx, dy);
    }

    pub fn set_mouse_buttons(&mut self, buttons: MouseButtons) {
        self.mouse.set_buttons(buttons);
    }

    pub fn scroll(&mut self, wheel: i32) {
        self.mouse.scroll(wheel);
    }

    /// Guest input stops while the game is behind. Events only ever reach the game
    /// process here, so there is nothing to undo.
    pub fn set_paused(&mut self, _paused: bool) {}
}
