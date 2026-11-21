//! The bubble: a small window that floats over the game while hosting, so the host can
//! copy the code, see guests, change what they may do and stop, without leaving the game.
//! Window capture only takes the game's own window, so guests never see it.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::webview::Color;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::Site;

const LABEL: &str = "bubble";
/// Closed, the bubble is a pill; open, a panel.
const CLOSED: (f64, f64) = (64.0, 64.0);
const OPEN: (f64, f64) = (340.0, 520.0);
/// Closed with someone asking to join, the pill grows to the left into a strip with their
/// name and the answers, the height it had.
const NOTICE_WIDTH: f64 = 340.0;
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
    page.set_path("/bubble");
    let (x, y) = top_right(app, CLOSED.0);
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(page))
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
        .focused(false);
    // On Windows and Linux a guest's mouse moves the real cursor, which can pass over the
    // bubble. A click there must never bring Couchwarp in front of the game: that would
    // pause every guest's keyboard and mouse, theirs included, with no way back.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.focusable(false);
    builder
        .on_navigation(move |url| url.origin() == origin)
        .build()?;
    Ok(())
}

pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
}

/// Which way the panel unfolds from the pill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Down,
    Up,
}

/// The way the open panel went, so closing puts the pill back on the same corner.
static OPENED_UP: AtomicBool = AtomicBool::new(false);

/// Opens the bubble into a panel or closes it back into a pill. The panel unfolds downward
/// from a pill in the top half of the screen and upward from one in the bottom half, and
/// never past the screen's edges. Returns the way it unfolded.
pub fn set_open(app: &AppHandle, open: bool) -> tauri::Result<Direction> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(Direction::Down);
    };
    let (current, screen) = frames(app, &window)?;
    let (next, direction) = if open {
        let (panel, direction) = panel_frame(current, screen);
        OPENED_UP.store(direction == Direction::Up, Ordering::Relaxed);
        (panel, direction)
    } else {
        let direction = if OPENED_UP.load(Ordering::Relaxed) {
            Direction::Up
        } else {
            Direction::Down
        };
        (pill_frame(current, direction, screen), direction)
    };
    window.set_size(LogicalSize::new(next.width, next.height))?;
    window.set_position(LogicalPosition::new(next.x, next.y))?;
    Ok(direction)
}

/// Widens the closed pill into a strip that says someone asks to join, or narrows it back.
/// The right edge stays put, so the pill does not move under the pointer.
pub fn set_notice(app: &AppHandle, shown: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    let (current, screen) = frames(app, &window)?;
    let next = notice_frame(current, shown, screen);
    window.set_size(LogicalSize::new(next.width, next.height))?;
    window.set_position(LogicalPosition::new(next.x, next.y))?;
    Ok(())
}

/// The bubble's window and the screen it is on, in logical pixels.
fn frames(app: &AppHandle, window: &tauri::WebviewWindow) -> tauri::Result<(Frame, Option<Frame>)> {
    let scale = window.scale_factor()?;
    let position = window.outer_position()?.to_logical::<f64>(scale);
    let size = window.outer_size()?.to_logical::<f64>(scale);
    let current = Frame {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let screen = window
        .current_monitor()?
        .or(app.primary_monitor()?)
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let origin = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            Frame {
                x: origin.x,
                y: origin.y,
                width: size.width,
                height: size.height,
            }
        });
    Ok((current, screen))
}

/// The closed bubble, as a strip or as the pill, keeping the right edge of `current`.
fn notice_frame(current: Frame, shown: bool, screen: Option<Frame>) -> Frame {
    let width = if shown { NOTICE_WIDTH } else { CLOSED.0 };
    inside(
        Frame {
            x: current.x + current.width - width,
            y: current.y,
            width,
            height: CLOSED.1,
        },
        screen,
    )
}

/// A rectangle on the desktop, in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Frame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// The panel opened from `pill`: its right edge on the pill's, its top on the pill's top
/// when unfolding down, its bottom on the pill's bottom when unfolding up.
fn panel_frame(pill: Frame, screen: Option<Frame>) -> (Frame, Direction) {
    let direction = match screen {
        Some(screen) if pill.y + pill.height / 2.0 >= screen.y + screen.height / 2.0 => {
            Direction::Up
        }
        _ => Direction::Down,
    };
    let (width, height) = OPEN;
    let y = match direction {
        Direction::Down => pill.y,
        Direction::Up => pill.y + pill.height - height,
    };
    let panel = Frame {
        x: pill.x + pill.width - width,
        y,
        width,
        height,
    };
    (inside(panel, screen), direction)
}

/// The pill closed from `panel`, back on the corner it unfolded from.
fn pill_frame(panel: Frame, direction: Direction, screen: Option<Frame>) -> Frame {
    let (width, height) = CLOSED;
    let y = match direction {
        Direction::Down => panel.y,
        Direction::Up => panel.y + panel.height - height,
    };
    let pill = Frame {
        x: panel.x + panel.width - width,
        y,
        width,
        height,
    };
    inside(pill, screen)
}

/// Moves `frame` back onto the screen, the top left corner first if it cannot fit.
fn inside(frame: Frame, screen: Option<Frame>) -> Frame {
    let Some(screen) = screen else { return frame };
    let fit =
        |start: f64, length: f64, low: f64, span: f64| start.min(low + span - length).max(low);
    Frame {
        x: fit(frame.x, frame.width, screen.x, screen.width),
        y: fit(frame.y, frame.height, screen.y, screen.height),
        ..frame
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_notice_grows_left_and_shrinks_back_onto_the_pill() {
        let pill = Frame {
            x: 1352.0,
            y: 48.0,
            width: CLOSED.0,
            height: CLOSED.1,
        };
        let strip = notice_frame(pill, true, Some(SCREEN));
        assert_eq!(strip.x + strip.width, pill.x + pill.width);
        assert_eq!(
            (strip.y, strip.width, strip.height),
            (48.0, NOTICE_WIDTH, 64.0)
        );
        assert_eq!(notice_frame(strip, false, Some(SCREEN)), pill);
    }

    #[test]
    fn a_pill_on_the_left_edge_keeps_its_notice_on_screen() {
        let pill = Frame {
            x: 0.0,
            y: 300.0,
            width: CLOSED.0,
            height: CLOSED.1,
        };
        assert_eq!(notice_frame(pill, true, Some(SCREEN)).x, 0.0);
    }

    const SCREEN: Frame = Frame {
        x: 0.0,
        y: 0.0,
        width: 1440.0,
        height: 900.0,
    };

    fn pill(x: f64, y: f64) -> Frame {
        Frame {
            x,
            y,
            width: CLOSED.0,
            height: CLOSED.1,
        }
    }

    #[test]
    fn unfolds_down_from_the_top_half() {
        let (panel, direction) = panel_frame(pill(1352.0, 48.0), Some(SCREEN));
        assert_eq!(direction, Direction::Down);
        assert_eq!((panel.x, panel.y), (1352.0 + 64.0 - 340.0, 48.0));
    }

    #[test]
    fn unfolds_up_from_the_bottom_half() {
        let (panel, direction) = panel_frame(pill(600.0, 800.0), Some(SCREEN));
        assert_eq!(direction, Direction::Up);
        // Its bottom stays on the pill's bottom.
        assert_eq!(panel.y + panel.height, 864.0);
    }

    #[test]
    fn never_leaves_the_screen_sideways() {
        // A pill against the left edge: the panel would start off screen.
        let (panel, _) = panel_frame(pill(10.0, 100.0), Some(SCREEN));
        assert_eq!(panel.x, 0.0);
        // A pill at the very bottom: the panel goes up and stays on the screen.
        let (panel, _) = panel_frame(pill(700.0, 880.0), Some(SCREEN));
        assert!(panel.y + panel.height <= SCREEN.height);
    }

    #[test]
    fn closes_back_onto_the_corner_it_opened_from() {
        let start = pill(600.0, 800.0);
        let (panel, direction) = panel_frame(start, Some(SCREEN));
        assert_eq!(pill_frame(panel, direction, Some(SCREEN)), start);
        let start = pill(1000.0, 60.0);
        let (panel, direction) = panel_frame(start, Some(SCREEN));
        assert_eq!(pill_frame(panel, direction, Some(SCREEN)), start);
    }
}
