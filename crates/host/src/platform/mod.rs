//! Everything that depends on the operating system: window capture, hardware encoding,
//! input injection and focus detection. Each backend exposes the same names.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
compile_error!(
    "the host runs on macOS for now; the Windows backend is the next milestone (docs/ARCHITECTURE.md)"
);
