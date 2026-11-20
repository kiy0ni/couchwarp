//! Linux host backend: X11 window capture (games under XWayland included), OpenH264,
//! `uinput` virtual devices for keys, mice and controllers, PulseAudio or PipeWire for the
//! game's sound.
//!
//! `uinput` needs write access to `/dev/uinput`. Desktops with Steam installed usually
//! grant it to the person at the screen (the `steam-devices` rules); otherwise a udev rule
//! does, see docs/DEPLOIEMENT.md.

pub mod capture;
pub use super::openh264 as encoder;
mod input;
mod sound;
mod x11;

pub use input::InputSink;

/// `uinput` devices type into whatever window is in front, so the focus lock must stay on.
pub const KEYS_REACH_GAME_ONLY: bool = false;

/// Nothing to set up on Linux; kept so every backend starts the same way.
pub fn init() {}

/// Whether guests' keys, mice and controllers can be played on this machine.
pub fn input_allowed() -> bool {
    input::uinput_writable()
}

/// Access to `/dev/uinput` comes from a udev rule: there is no prompt to show.
pub fn ask_input_permission() {}

/// Linux lets any app capture a window: nothing to ask.
pub fn ask_screen_permission() {}

/// The process of the window in front, as the window manager tells X11 clients.
pub fn frontmost_pid() -> Option<i32> {
    x11::active_window_pid()
}
