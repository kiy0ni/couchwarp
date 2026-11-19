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

#[cfg(not(any(target_os = "macos", windows)))]
compile_error!(
    "the host runs on macOS and Windows; Linux is on the roadmap (docs/ARCHITECTURE.md)"
);
