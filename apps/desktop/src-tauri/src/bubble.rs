//! The bubble: a small window that floats over the game while hosting, so the host can
//! copy the code, see guests, change what they may do and stop, without leaving the game.
//! Window capture only takes the game's own window, so guests never see it.

use tauri::webview::Color;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::Site;

const LABEL: &str = "bubble";
/// Closed, the bubble is a pill; open, a panel.
const CLOSED: (f64, f64) = (64.0, 64.0);
const OPEN: (f64, f64) = (340.0, 520.0);
/// Distance from the top right corner of the screen.
const MARGIN: f64 = 24.0;

/// Shows the bubble, if it is not already up.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let site = app.state::<Site>().0.clone();
    let origin = site.origin();
    let mut page = site;
    page.set_path("/bulle");
    let (x, y) = top_right(app, CLOSED.0);
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(page))
        .title("Couchwarp")
        .inner_size(CLOSED.0, CLOSED.1)
        .position(x, y)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        // The game keeps the keyboard: guests' keys wait while another window is in front.
        .focused(false)
        .on_navigation(move |url| url.origin() == origin)
        .build()?;
    Ok(())
}

pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
}

/// Opens the bubble into a panel or closes it back into a pill, keeping its right edge
/// where it was so it never grows off the screen.
pub fn set_open(app: &AppHandle, open: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    let scale = window.scale_factor()?;
    let position = window.outer_position()?.to_logical::<f64>(scale);
    let size = window.outer_size()?.to_logical::<f64>(scale);
    let right = position.x + size.width;
    let (width, height) = if open { OPEN } else { CLOSED };
    window.set_size(LogicalSize::new(width, height))?;
    window.set_position(LogicalPosition::new(right - width, position.y))?;
    Ok(())
}

fn top_right(app: &AppHandle, width: f64) -> (f64, f64) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return (MARGIN, MARGIN);
    };
    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    (
        origin.x + screen.width - width - MARGIN,
        origin.y + MARGIN * 2.0,
    )
}
