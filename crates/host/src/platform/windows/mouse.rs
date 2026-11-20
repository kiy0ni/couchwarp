//! Plays guests' mice with SendInput, which games read like a real mouse: relative
//! movement, buttons and wheel. SendInput moves the system cursor, so while guests use
//! the mouse the cursor is confined to the game window (ClipCursor): a click can never
//! land in another window. The router sends nothing while the game is behind, and the
//! confinement ends as soon as it is.
//!
//! Windows drops the confinement on its own whenever the foreground changes (a
//! notification, a UAC prompt, the host's Alt+Tab). It is checked again before each
//! event: a guest's cursor that left the game would click another window, put the game
//! behind and pause every guest's mouse with no way back.

use std::mem::size_of;

use couchwarp_protocol::input::MouseButtons;
use tracing::warn;
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_MOUSE, MOUSE_EVENT_FLAGS, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSEINPUT,
    SendInput,
};
use windows::Win32::UI::WindowsAndMessaging::{
    ClipCursor, GetClientRect, GetClipCursor, GetForegroundWindow,
};

use crate::input::button_changes;

/// `mouseData` for the side buttons.
const XBUTTON1: u32 = 1;
const XBUTTON2: u32 = 2;

#[derive(Default)]
pub struct MouseSink {
    held: MouseButtons,
    confined: bool,
}

impl MouseSink {
    pub fn move_by(&mut self, dx: i32, dy: i32) {
        self.confine();
        send(MOUSEEVENTF_MOVE, dx, dy, 0);
    }

    pub fn set_buttons(&mut self, buttons: MouseButtons) {
        let changes = button_changes(self.held, buttons);
        self.held = buttons;
        if !changes.is_empty() && buttons != MouseButtons::default() {
            self.confine();
        }
        for (button, down) in changes {
            let (flags, data) = match (button, down) {
                (MouseButtons::LEFT, true) => (MOUSEEVENTF_LEFTDOWN, 0),
                (MouseButtons::LEFT, false) => (MOUSEEVENTF_LEFTUP, 0),
                (MouseButtons::RIGHT, true) => (MOUSEEVENTF_RIGHTDOWN, 0),
                (MouseButtons::RIGHT, false) => (MOUSEEVENTF_RIGHTUP, 0),
                (MouseButtons::MIDDLE, true) => (MOUSEEVENTF_MIDDLEDOWN, 0),
                (MouseButtons::MIDDLE, false) => (MOUSEEVENTF_MIDDLEUP, 0),
                (MouseButtons::BACK, true) => (MOUSEEVENTF_XDOWN, XBUTTON1),
                (MouseButtons::BACK, false) => (MOUSEEVENTF_XUP, XBUTTON1),
                (_, true) => (MOUSEEVENTF_XDOWN, XBUTTON2),
                (_, false) => (MOUSEEVENTF_XUP, XBUTTON2),
            };
            send(flags, 0, 0, data);
        }
    }

    /// `wheel` in 1/120ths of a notch, positive down; Windows counts positive up.
    pub fn scroll(&mut self, wheel: i32) {
        self.confine();
        send(MOUSEEVENTF_WHEEL, 0, 0, wheel.wrapping_neg() as u32);
    }

    /// Lets the cursor go, for when the game is no longer in front.
    pub fn release(&mut self) {
        self.set_buttons(MouseButtons::default());
        if self.confined {
            self.confined = false;
            // SAFETY: no rectangle means no confinement.
            if let Err(error) = unsafe { ClipCursor(None) } {
                warn!(%error, "cursor not released");
            }
        }
    }

    /// Keeps the cursor inside the game window, which is in front whenever the router
    /// lets mouse input through. Cheap enough to run before every event.
    fn confine(&mut self) {
        let Some(area) = game_area() else { return };
        let mut current = RECT::default();
        // SAFETY: `current` lives on this stack frame for the duration of the call.
        let unchanged = unsafe { GetClipCursor(&mut current) }.is_ok() && current == area;
        if self.confined && unchanged {
            return;
        }
        // SAFETY: `area` is a valid rectangle on this stack frame.
        match unsafe { ClipCursor(Some(&area)) } {
            Ok(()) => self.confined = true,
            Err(error) => warn!(%error, "cursor not confined to the game window"),
        }
    }
}

/// The client area of the window in front, in screen coordinates.
fn game_area() -> Option<RECT> {
    // SAFETY: plain Win32 queries on the foreground window; the out values live on this
    // stack frame.
    unsafe {
        let window = GetForegroundWindow();
        let mut client = RECT::default();
        if window.is_invalid() || GetClientRect(window, &mut client).is_err() {
            return None;
        }
        let mut top_left = POINT {
            x: client.left,
            y: client.top,
        };
        let mut bottom_right = POINT {
            x: client.right,
            y: client.bottom,
        };
        if !ClientToScreen(window, &mut top_left).as_bool()
            || !ClientToScreen(window, &mut bottom_right).as_bool()
        {
            return None;
        }
        Some(RECT {
            left: top_left.x,
            top: top_left.y,
            right: bottom_right.x,
            bottom: bottom_right.y,
        })
    }
}

impl Drop for MouseSink {
    fn drop(&mut self) {
        self.release();
    }
}

fn send(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32, data: u32) {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    // SAFETY: one fully initialized mouse input, with its exact size.
    let sent = unsafe { SendInput(&[input], size_of::<INPUT>() as i32) };
    if sent != 1 {
        warn!("mouse input not sent: Windows blocks input into windows run as administrator");
    }
}
