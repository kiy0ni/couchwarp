//! What the site's pages may ask the app, through `window.__TAURI_INTERNALS__`. Each
//! command is allowed in `capabilities/site.json`, for the site's address only.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use couchwarp_host::account::{self, Provider};
use tauri::{AppHandle, State};

use crate::Site;
use crate::hosting::{Hosting, HostingState, StartRequest, WindowInfo, shareable_windows};

/// Blocking work (system calls, HTTPS requests) off the thread that draws the window.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub async fn list_windows() -> Result<Vec<WindowInfo>, String> {
    blocking(|| Ok(shareable_windows()?.iter().map(WindowInfo::from).collect())).await
}

/// A small picture of the window as a `data:` address, or null when it shows nothing.
#[tauri::command]
pub async fn window_preview(id: String) -> Result<Option<String>, String> {
    blocking(move || {
        let Some(window) = shareable_windows()?
            .into_iter()
            .find(|window| window.id.to_string() == id)
        else {
            return Ok(None);
        };
        Ok(window
            .preview()
            .ok()
            .map(|jpeg| format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg))))
    })
    .await
}

#[tauri::command]
pub fn hosting_state(hosting: State<'_, Hosting>) -> HostingState {
    hosting.state()
}

#[tauri::command]
pub fn start_hosting(
    app: AppHandle,
    site: State<'_, Site>,
    hosting: State<'_, Hosting>,
    request: StartRequest,
) -> Result<(), String> {
    hosting.start(app, site.address(), request)
}

#[tauri::command]
pub fn stop_hosting(hosting: State<'_, Hosting>) {
    hosting.stop();
}

/// The token this computer keeps for the site, so the page can sign its window in too.
#[tauri::command]
pub fn saved_session(site: State<'_, Site>) -> Option<String> {
    account::token(&site.address())
}

/// Signs in through the system browser. Returns the new token.
#[tauri::command]
pub async fn sign_in(site: State<'_, Site>, provider: String) -> Result<String, String> {
    let provider = match provider.as_str() {
        "discord" => Provider::Discord,
        "google" => Provider::Google,
        _ => return Err("unknown-provider".to_owned()),
    };
    let server = site.address();
    blocking(move || {
        account::sign_in(&server, provider, |_| {})?;
        account::token(&server).ok_or_else(|| anyhow::anyhow!("the session was not kept"))
    })
    .await
}

#[tauri::command]
pub async fn sign_out(site: State<'_, Site>) -> Result<(), String> {
    let server = site.address();
    blocking(move || account::sign_out(&server).map(|_| ())).await
}

/// Whether guests' keys and mice can reach the game. On a Mac, asks the first time.
#[tauri::command]
pub fn input_allowed() -> bool {
    couchwarp_host::platform::can_send_keys()
}

/// Opens the system settings where the app is allowed to record the screen or to send
/// keys. Only a Mac asks for these.
#[tauri::command]
pub fn open_privacy_settings(app: AppHandle, pane: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let anchor = match pane.as_str() {
        "screen" => "Privacy_ScreenCapture",
        "input" => "Privacy_Accessibility",
        _ => return Err("unknown-pane".to_owned()),
    };
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    app.opener()
        .open_url(
            format!("x-apple.systempreferences:com.apple.preference.security?{anchor}"),
            None::<&str>,
        )
        .map_err(|error| error.to_string())
}

/// Opens the bubble into its panel, or closes it back into a pill.
#[tauri::command]
pub fn set_bubble_open(app: AppHandle, open: bool) -> Result<(), String> {
    crate::bubble::set_open(&app, open).map_err(|error| error.to_string())
}

/// Brings the main window forward, from the bubble.
#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let window = app.get_webview_window("main").ok_or("no-main-window")?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}
