//! Couchwarp host: shares one game window with guests who join from a browser.
//!
//! The command line (`main.rs`) and the desktop app (`apps/desktop`) both drive a
//! [`session`]: pick a window, open a room, stream until someone stops it.

pub mod account;
mod audio;
#[cfg(any(target_os = "macos", test))]
mod avcc;
mod bitrate;
#[cfg(any(windows, test))]
mod ds4;
mod host;
mod input;
mod net;
#[cfg(any(windows, test))]
mod pc_keys;
mod peer;
pub mod platform;
pub mod session;
mod signaling;
#[cfg(any(windows, test))]
mod software_h264;
mod stats;
mod stun;
mod thumbnail;
mod video;
#[cfg(any(windows, test))]
mod xinput;

pub use host::SettingsRequest;
