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
    /// Keys the guests type.
    typed: Vec<u8>,
    /// Keys each player's controller holds, by slot (see `pad_keys`).
    pad_keys: std::collections::BTreeMap<u8, Vec<u8>>,
}

impl InputSink {
    pub fn new(game_pid: i32) -> Self {
        Self {
            keyboard: KeyboardSink::new(game_pid),
            mouse: MouseSink::new(game_pid),
            typed: Vec::new(),
            pad_keys: std::collections::BTreeMap::new(),
        }
    }

    /// Typed keys and controllers' keys together, each key once.
    fn press_keys(&mut self) {
        let mut keys = self.typed.clone();
        for key in self.pad_keys.values().flatten() {
            if !keys.contains(key) {
                keys.push(*key);
            }
        }
        self.keyboard.set_keys(&keys);
    }

    /// Guests' mice move the real cursor, for games that read it.
    pub fn set_system_pointer(&mut self, on: bool) {
        self.mouse.set_system_pointer(on);
    }

    /// The game came back as another process: keys and clicks go to it from now on.
    pub fn set_game(&mut self, game_pid: i32) {
        self.keyboard.set_keys(&[]);
        self.typed.clear();
        self.pad_keys.clear();
        self.mouse.set_buttons(MouseButtons(0));
        let system_pointer = self.mouse.system_pointer();
        self.keyboard = KeyboardSink::new(game_pid);
        self.mouse = MouseSink::new(game_pid);
        self.mouse.set_system_pointer(system_pointer);
    }

    /// Whether guests' controllers reach the game. On macOS they do as keys, for players
    /// 1 and 2: no virtual controller can exist there.
    pub fn virtual_pads(&self) -> bool {
        true
    }

    pub fn set_keys(&mut self, keys: &[u8]) {
        self.typed = keys.to_vec();
        self.press_keys();
    }

    pub fn set_pad(&mut self, slot: u8, _pad_type: PadType, state: &GamepadState) {
        let keys = crate::pad_keys::keys_for(slot, state);
        if self.pad_keys.get(&slot) != Some(&keys) {
            self.pad_keys.insert(slot, keys);
            self.press_keys();
        }
    }

    pub fn release_pad(&mut self, slot: u8) {
        if self.pad_keys.remove(&slot).is_some() {
            self.press_keys();
        }
    }

    /// Controllers play as keys here: nothing to plug in.
    pub fn prepare_pads(&mut self, _players: u8) {}

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
