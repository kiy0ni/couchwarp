//! The game's program: found from the shared window's process when hosting starts, so the
//! game can be started again if it closes while guests wait.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context, Result};

/// The program file of process `pid`, if the system tells.
pub fn executable(pid: i32) -> Option<PathBuf> {
    let path = program_of(pid)?;
    path.is_file().then_some(path)
}

/// Starts the game again from its program. On macOS, a program inside an app bundle is
/// opened as the app, as the Finder does.
pub fn launch(program: &Path) -> Result<()> {
    let mut command = launcher(program);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
        .spawn()
        .with_context(|| format!("could not start {}", program.display()))?;
    Ok(())
}

fn launcher(program: &Path) -> Command {
    if cfg!(target_os = "macos")
        && let Some(bundle) = app_bundle(program)
    {
        let mut command = Command::new("open");
        command.arg(bundle);
        return command;
    }
    let mut command = Command::new(program);
    // Games read their files from where they are, not from where Couchwarp runs.
    if let Some(folder) = program.parent() {
        command.current_dir(folder);
    }
    command
}

/// The outermost `.app` folder holding `program`.
fn app_bundle(program: &Path) -> Option<&Path> {
    program
        .ancestors()
        .filter(|folder| {
            folder
                .extension()
                .is_some_and(|extension| extension == "app")
        })
        .last()
}

#[cfg(target_os = "macos")]
fn program_of(pid: i32) -> Option<PathBuf> {
    use std::ffi::{OsStr, c_int, c_void};
    use std::os::unix::ffi::OsStrExt;

    /// `PROC_PIDPATHINFO_MAXSIZE` in `<libproc.h>`.
    const MAX_PATH: usize = 4096;
    unsafe extern "C" {
        fn proc_pidpath(pid: c_int, buffer: *mut c_void, size: u32) -> c_int;
    }
    let mut buffer = [0u8; MAX_PATH];
    // SAFETY: the buffer is valid for its whole length for the call.
    let length = unsafe { proc_pidpath(pid, buffer.as_mut_ptr().cast(), MAX_PATH as u32) };
    let length = usize::try_from(length).ok().filter(|&length| length > 0)?;
    Some(PathBuf::from(OsStr::from_bytes(&buffer[..length])))
}

#[cfg(windows)]
fn program_of(pid: i32) -> Option<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::core::PWSTR;

    let pid = u32::try_from(pid).ok()?;
    // SAFETY: plain call; the handle is closed below.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = vec![0u16; 32_768];
    let mut length = buffer.len() as u32;
    // SAFETY: `buffer` holds `length` characters, and the handle is open.
    let found = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    // SAFETY: the handle came from OpenProcess and is closed once.
    let _ = unsafe { CloseHandle(process) };
    found.ok()?;
    Some(PathBuf::from(OsString::from_wide(
        &buffer[..length as usize],
    )))
}

#[cfg(target_os = "linux")]
fn program_of(pid: i32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/exe")).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_process_has_a_program() {
        let own = executable(std::process::id() as i32).expect("our own program");
        assert_eq!(
            own.canonicalize().unwrap(),
            std::env::current_exe().unwrap().canonicalize().unwrap()
        );
    }

    #[test]
    fn a_program_in_a_bundle_opens_the_outer_app() {
        let program =
            Path::new("/Applications/Game.app/Contents/Helpers/Inner.app/Contents/MacOS/inner");
        assert_eq!(
            app_bundle(program),
            Some(Path::new("/Applications/Game.app"))
        );
        assert_eq!(app_bundle(Path::new("/usr/local/bin/game")), None);
    }
}
