//! Keeps the computer and its screen awake while a game is running: a host that falls
//! asleep drops every guest.

/// Holds the computer awake until dropped.
pub struct KeepAwake {
    #[cfg(target_os = "macos")]
    caffeinate: Option<std::process::Child>,
}

impl KeepAwake {
    /// On a Mac, the system's own `caffeinate` holds the assertion and ends with this app
    /// even if it crashes. On Windows, the calling thread asks for it and must outlive it.
    pub fn start() -> Self {
        #[cfg(target_os = "macos")]
        {
            let caffeinate = std::process::Command::new("/usr/bin/caffeinate")
                .args(["-d", "-i", "-w", &std::process::id().to_string()])
                .spawn()
                .map_err(|error| tracing::warn!(%error, "could not keep the Mac awake"))
                .ok();
            Self { caffeinate }
        }
        #[cfg(windows)]
        {
            use windows::Win32::System::Power::{
                ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED, SetThreadExecutionState,
            };
            // SAFETY: a plain flag call with no pointers.
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
            };
            Self {}
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        Self {}
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        if let Some(mut child) = self.caffeinate.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        #[cfg(windows)]
        {
            use windows::Win32::System::Power::{ES_CONTINUOUS, SetThreadExecutionState};
            // SAFETY: as above.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        }
    }
}
