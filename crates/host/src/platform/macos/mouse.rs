//! Plays guests' mice into the game process with CoreGraphics events. Like keys, mouse
//! events are posted to the game's process only: the host's own cursor never moves, and
//! a click cannot land in another app.
//!
//! Games that read raw movement get the deltas; games that read the pointer position get
//! a virtual pointer kept inside their window.

use std::time::{Duration, Instant};

use couchwarp_protocol::input::MouseButtons;
use objc2_core_foundation::{CGPoint, CGRect};
use objc2_core_graphics::{CGEvent, CGEventField, CGEventType, CGMouseButton, CGScrollEventUnit};

use super::window_bounds;
use crate::input::button_changes;

/// The window can move or resize; its bounds are read again after this long.
const BOUNDS_FOR: Duration = Duration::from_secs(1);
/// Wheel units per line scrolled: the protocol counts 120 per notch, as Windows does.
const WHEEL_PER_LINE: i32 = 120;

pub struct MouseSink {
    pid: i32,
    position: Option<CGPoint>,
    held: MouseButtons,
    bounds: Option<(CGRect, Instant)>,
}

impl MouseSink {
    pub fn new(pid: i32) -> Self {
        Self {
            pid,
            position: None,
            held: MouseButtons::default(),
            bounds: None,
        }
    }

    pub fn move_by(&mut self, dx: i32, dy: i32) {
        let Some(bounds) = self.bounds() else { return };
        let from = self.position.unwrap_or(center(bounds));
        let to = clamp(
            CGPoint {
                x: from.x + f64::from(dx),
                y: from.y + f64::from(dy),
            },
            bounds,
        );
        self.position = Some(to);
        let (kind, button) = if self.held.contains(MouseButtons::LEFT) {
            (CGEventType::LeftMouseDragged, CGMouseButton::Left)
        } else if self.held.contains(MouseButtons::RIGHT) {
            (CGEventType::RightMouseDragged, CGMouseButton::Right)
        } else {
            (CGEventType::MouseMoved, CGMouseButton::Left)
        };
        let Some(event) = CGEvent::new_mouse_event(None, kind, to, button) else {
            return;
        };
        CGEvent::set_integer_value_field(Some(&event), CGEventField::MouseEventDeltaX, dx.into());
        CGEvent::set_integer_value_field(Some(&event), CGEventField::MouseEventDeltaY, dy.into());
        CGEvent::post_to_pid(self.pid, Some(&event));
    }

    pub fn set_buttons(&mut self, buttons: MouseButtons) {
        let changes = button_changes(self.held, buttons);
        self.held = buttons;
        let Some(bounds) = self.bounds() else { return };
        let at = *self.position.get_or_insert(center(bounds));
        for (button, down) in changes {
            let (kind, mac_button, number) = match (button, down) {
                (MouseButtons::LEFT, true) => (CGEventType::LeftMouseDown, CGMouseButton::Left, 0),
                (MouseButtons::LEFT, false) => (CGEventType::LeftMouseUp, CGMouseButton::Left, 0),
                (MouseButtons::RIGHT, true) => {
                    (CGEventType::RightMouseDown, CGMouseButton::Right, 1)
                }
                (MouseButtons::RIGHT, false) => {
                    (CGEventType::RightMouseUp, CGMouseButton::Right, 1)
                }
                (other, down) => {
                    let number = match other {
                        MouseButtons::MIDDLE => 2,
                        MouseButtons::BACK => 3,
                        _ => 4,
                    };
                    let kind = if down {
                        CGEventType::OtherMouseDown
                    } else {
                        CGEventType::OtherMouseUp
                    };
                    (kind, CGMouseButton::Center, number)
                }
            };
            let Some(event) = CGEvent::new_mouse_event(None, kind, at, mac_button) else {
                continue;
            };
            CGEvent::set_integer_value_field(
                Some(&event),
                CGEventField::MouseEventButtonNumber,
                number,
            );
            CGEvent::post_to_pid(self.pid, Some(&event));
        }
    }

    /// `wheel` in 1/120ths of a notch, positive down. macOS counts lines, positive up.
    pub fn scroll(&mut self, wheel: i32) {
        let lines = -wheel / WHEEL_PER_LINE;
        if lines == 0 {
            return;
        }
        let Some(event) =
            CGEvent::new_scroll_wheel_event2(None, CGScrollEventUnit::Line, 1, lines, 0, 0)
        else {
            return;
        };
        CGEvent::post_to_pid(self.pid, Some(&event));
    }

    fn bounds(&mut self) -> Option<CGRect> {
        let fresh = self
            .bounds
            .filter(|(_, at)| at.elapsed() < BOUNDS_FOR)
            .map(|(bounds, _)| bounds);
        let bounds = fresh.or_else(|| window_bounds(self.pid))?;
        self.bounds = Some((bounds, Instant::now()));
        Some(bounds)
    }
}

impl Drop for MouseSink {
    fn drop(&mut self) {
        self.set_buttons(MouseButtons::default());
    }
}

fn center(bounds: CGRect) -> CGPoint {
    CGPoint {
        x: bounds.origin.x + bounds.size.width / 2.0,
        y: bounds.origin.y + bounds.size.height / 2.0,
    }
}

/// Keeps the virtual pointer inside the window, one point in from each edge.
fn clamp(point: CGPoint, bounds: CGRect) -> CGPoint {
    let right = bounds.origin.x + bounds.size.width - 1.0;
    let bottom = bounds.origin.y + bounds.size.height - 1.0;
    CGPoint {
        x: point.x.clamp(bounds.origin.x, right.max(bounds.origin.x)),
        y: point.y.clamp(bounds.origin.y, bottom.max(bounds.origin.y)),
    }
}
