//! Windows Defender Firewall drops guests' packets to an app it has no inbound rule for:
//! guests then cannot connect at all, even on the same network. Windows asks once with a
//! dialog of its own, which is easy to miss, and a press on Cancel leaves a block rule
//! that wins over any later allow. The app checks its rules and, when they are missing or
//! blocking, puts them right with one administrator prompt.
//!
//! macOS and Linux let an app receive what it asked for: nothing to do there.

/// Whether guests' packets reach the app.
#[cfg(windows)]
pub fn allowed() -> anyhow::Result<bool> {
    let exe = own_path()?;
    let script = format!(
        "$rules = Get-NetFirewallApplicationFilter -Program '{exe}' -ErrorAction SilentlyContinue | \
         Get-NetFirewallRule | Where-Object {{ $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and \
         (($_ | Get-NetFirewallPortFilter).Protocol -in 'UDP', 'Any') }}\n\
         if ($rules | Where-Object Action -eq 'Block') {{ 'blocked' }} \
         elseif ($rules | Where-Object Action -eq 'Allow') {{ 'allowed' }} else {{ 'missing' }}"
    );
    let output = powershell(&script).output()?;
    Ok(String::from_utf8_lossy(&output.stdout).trim() == "allowed")
}

/// Removes block rules for the app and adds an allow rule, as administrator: Windows shows
/// its prompt. Fails when the person declines it.
#[cfg(windows)]
pub fn allow() -> anyhow::Result<()> {
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;

    let exe = own_path()?;
    let script = format!(
        "Get-NetFirewallApplicationFilter -Program '{exe}' -ErrorAction SilentlyContinue | \
         Get-NetFirewallRule | Where-Object Action -eq 'Block' | Remove-NetFirewallRule\n\
         Remove-NetFirewallRule -DisplayName 'Couchwarp' -ErrorAction SilentlyContinue\n\
         New-NetFirewallRule -DisplayName 'Couchwarp' -Description 'Guests connect to the game Couchwarp shares.' \
         -Direction Inbound -Program '{exe}' -Protocol UDP -Action Allow -Profile Any | Out-Null"
    );
    // PowerShell takes an encoded command as UTF-16, which no quoting can break.
    let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let elevate = format!(
        "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden \
         -ArgumentList '-NoProfile', '-EncodedCommand', '{}'",
        STANDARD.encode(utf16)
    );
    let status = powershell(&elevate).status()?;
    anyhow::ensure!(status.success(), "the administrator prompt was declined");
    Ok(())
}

/// This app's path, quoted for a PowerShell single-quoted string.
#[cfg(windows)]
fn own_path() -> anyhow::Result<String> {
    Ok(std::env::current_exe()?
        .display()
        .to_string()
        .replace('\'', "''"))
}

#[cfg(windows)]
fn powershell(script: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    /// No console window flashes on screen.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = std::process::Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
pub fn allowed() -> anyhow::Result<bool> {
    Ok(true)
}

#[cfg(not(windows))]
pub fn allow() -> anyhow::Result<()> {
    Ok(())
}
