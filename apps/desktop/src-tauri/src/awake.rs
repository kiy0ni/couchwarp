//! Keeps the computer and its screen awake while a game is running: a host that falls
//! asleep drops every guest.

/// Holds the computer awake until dropped.
pub struct KeepAwake {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    helper: Option<std::process::Child>,
}

impl KeepAwake {
    /// On a Mac and on Linux, a system tool holds the lock and lets go when this app ends,
    /// even if it crashes. On Windows, the calling thread asks for it and must outlive it.
    pub fn start() -> Self {
        #[cfg(target_os = "macos")]
        {
            let pid = std::process::id().to_string();
            Self {
                helper: spawn("/usr/bin/caffeinate", &["-d", "-i", "-w", &pid]),
            }
        }
        #[cfg(target_os = "linux")]
        {
            // `tail --pid` ends with this app, and the lock with it.
            let pid = std::process::id().to_string();
            Self {
                helper: spawn(
                    "systemd-inhibit",
                    &[
                        "--what=idle:sleep",
                        "--who=Couchwarp",
                        "--why=Guests are playing a game hosted on this computer",
                        "tail",
                        &format!("--pid={pid}"),
                        "-f",
                        "/dev/null",
                    ],
                ),
            }
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
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn spawn(program: &str, args: &[&str]) -> Option<std::process::Child> {
    std::process::Command::new(program)
        .args(args)
        .spawn()
        .map_err(|error| tracing::warn!(%error, program, "could not keep the computer awake"))
        .ok()
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(mut child) = self.helper.take() {
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
