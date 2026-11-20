//! What guests' controllers need on this computer, and setting it up from the app, so no
//! one has to read a guide:
//!
//! - Windows: VIIPER, a small service with a signed USB driver that creates virtual
//!   controllers. The app downloads a pinned, checked version and runs its own quiet
//!   installer (Windows asks once for administrator rights, for the driver), then starts
//!   it whenever a game starts.
//! - Linux: write access to `/dev/uinput`, given by a udev rule the app installs through
//!   the system's password prompt (`pkexec`).
//! - macOS: no app may create a virtual controller; guests play with the keyboard.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
// A Mac only ever answers `Impossible`.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub enum Support {
    /// Guests' controllers play into games.
    Ready,
    /// Installed but not running; the app starts it with the next game.
    Stopped,
    /// One click away: the app can install what is missing.
    Missing,
    /// This system cannot have virtual controllers.
    Impossible,
}

#[cfg(windows)]
pub use windows::{ensure_running, install, support};

#[cfg(target_os = "linux")]
pub use linux::{ensure_running, install, support};

#[cfg(target_os = "macos")]
pub fn support() -> Support {
    Support::Impossible
}

#[cfg(target_os = "macos")]
pub fn install() -> anyhow::Result<()> {
    anyhow::bail!("macOS does not let apps create virtual controllers")
}

#[cfg(target_os = "macos")]
pub fn ensure_running() {}

#[cfg(windows)]
mod windows {
    use std::io::Read;
    use std::net::{SocketAddr, TcpStream};
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    use anyhow::{Context, Result, ensure};
    use sha2::{Digest, Sha256};
    use tracing::{info, warn};

    use super::Support;

    /// A release checked by hand. Its digest is compared before anything runs.
    const RELEASE: &str =
        "https://github.com/Alia5/VIIPER/releases/download/v0.9.0/viiper-windows-amd64.exe";
    const SHA256: &str = "142c144f6abee8b8a5f6a1abbc7018683444de71d2e45102cde6aaab9b2223e6";
    const MAX_DOWNLOAD: u64 = 64 * 1024 * 1024;
    /// Where the host looks for VIIPER (`crates/host/src/platform/windows/pads.rs`).
    const API: &str = "127.0.0.1:3242";
    const START_WAIT: Duration = Duration::from_secs(8);
    /// No console window flashes on screen for a background service.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;

    fn answers() -> bool {
        let address: SocketAddr = API.parse().expect("a valid address");
        TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
    }

    /// Where VIIPER's installer puts it, for the current user.
    fn installed_exe() -> Option<PathBuf> {
        let path = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(r"VIIPER\viiper.exe");
        path.is_file().then_some(path)
    }

    pub fn support() -> Support {
        if answers() {
            Support::Ready
        } else if installed_exe().is_some() {
            Support::Stopped
        } else {
            Support::Missing
        }
    }

    /// Downloads the pinned release, checks it, and runs its quiet install.
    pub fn install() -> Result<()> {
        let installer = std::env::temp_dir().join("couchwarp-viiper-setup.exe");
        let bytes = download()?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        ensure!(
            digest == SHA256,
            "the downloaded VIIPER does not match the expected file"
        );
        std::fs::write(&installer, &bytes).context("could not save the VIIPER installer")?;
        info!("installing VIIPER");
        let status = Command::new(&installer)
            .args(["install", "--quiet"])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .context("the VIIPER installer did not start")?;
        // The installer is copied into place; this copy is no longer needed.
        let _ = std::fs::remove_file(&installer);
        ensure!(status.success(), "the VIIPER installer stopped ({status})");
        ensure_running();
        Ok(())
    }

    fn download() -> Result<Vec<u8>> {
        let mut response = ureq::get(RELEASE)
            .call()
            .context("could not download VIIPER")?;
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take(MAX_DOWNLOAD)
            .read_to_end(&mut bytes)
            .context("the VIIPER download was cut")?;
        Ok(bytes)
    }

    /// Starts the installed service if it is not running, and waits a little for it.
    pub fn ensure_running() {
        if answers() {
            return;
        }
        let Some(exe) = installed_exe() else { return };
        info!("starting VIIPER");
        let started = Command::new(exe)
            .args(["server", "--no-tray"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn();
        if let Err(error) = started {
            warn!(%error, "VIIPER did not start");
            return;
        }
        let deadline = Instant::now() + START_WAIT;
        while !answers() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(200));
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::fs::OpenOptions;
    use std::process::Command;

    use anyhow::{Context, Result, ensure};

    use super::Support;

    /// The rule `steam-devices` ships: the person at the screen may use `/dev/uinput`.
    const SETUP: &str = r#"set -e
modprobe uinput || true
echo 'KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"' > /etc/udev/rules.d/60-couchwarp-uinput.rules
echo uinput > /etc/modules-load.d/couchwarp-uinput.conf
udevadm control --reload
udevadm trigger --name-match=uinput || udevadm trigger"#;

    pub fn support() -> Support {
        if OpenOptions::new().write(true).open("/dev/uinput").is_ok() {
            Support::Ready
        } else {
            Support::Missing
        }
    }

    /// Installs the rule as administrator, through the desktop's own password prompt.
    pub fn install() -> Result<()> {
        let status = Command::new("pkexec")
            .args(["sh", "-c", SETUP])
            .status()
            .context("pkexec is missing: install polkit, or add the udev rule by hand")?;
        ensure!(status.success(), "the rule was not installed ({status})");
        Ok(())
    }

    /// The rule applies on its own once installed.
    pub fn ensure_running() {}
}
