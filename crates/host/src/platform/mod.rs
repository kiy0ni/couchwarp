//! Everything that depends on the operating system: window capture, video encoding,
//! input injection, sound and focus detection. Each backend exposes the same names.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

/// The software encoder Windows and Linux share, as `platform::encoder` there.
#[cfg(any(windows, target_os = "linux"))]
pub mod openh264;

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
compile_error!("the host runs on macOS, Windows and Linux");
