//! Plays guests' keys into the game process with CoreGraphics events.
//!
//! Events are posted to the game's process only, not to the system, so even a bug in the
//! focus lock could not type into another app.

use objc2_core_graphics::{CGEvent, CGEventFlags, CGEventType};

use crate::input::key_changes;

pub struct KeyboardSink {
    pid: i32,
    held: Vec<u8>,
}

impl KeyboardSink {
    pub fn new(pid: i32) -> Self {
        Self {
            pid,
            held: Vec::new(),
        }
    }

    /// Presses and releases whatever differs between the keys held now and `keys`.
    pub fn set_keys(&mut self, keys: &[u8]) {
        let (released, pressed) = key_changes(&self.held, keys);
        self.held = keys.to_vec();
        for usage in released {
            self.post(usage, false);
        }
        for usage in pressed {
            self.post(usage, true);
        }
    }

    fn post(&self, usage: u8, down: bool) {
        let Some(key_code) = mac_key_code(usage) else {
            return;
        };
        let Some(event) = CGEvent::new_keyboard_event(None, key_code, down) else {
            return;
        };
        // Apps read Shift, Control and Option from the flags of each event, not from
        // earlier key presses, so every event carries the modifiers held with it.
        CGEvent::set_flags(Some(&event), modifier_flags(&self.held));
        if is_modifier(usage) {
            CGEvent::set_type(Some(&event), CGEventType::FlagsChanged);
        }
        CGEvent::post_to_pid(self.pid, Some(&event));
    }
}

impl Drop for KeyboardSink {
    fn drop(&mut self) {
        self.set_keys(&[]);
    }
}

fn is_modifier(usage: u8) -> bool {
    (0xe0..=0xe7).contains(&usage)
}

fn modifier_flags(held: &[u8]) -> CGEventFlags {
    let mut flags = CGEventFlags::empty();
    for &usage in held {
        flags |= match usage {
            0xe0 | 0xe4 => CGEventFlags::MaskControl,
            0xe1 | 0xe5 => CGEventFlags::MaskShift,
            0xe2 | 0xe6 => CGEventFlags::MaskAlternate,
            0xe3 | 0xe7 => CGEventFlags::MaskCommand,
            _ => CGEventFlags::empty(),
        };
    }
    flags
}

/// USB HID usage (keyboard page) to macOS virtual key code (`kVK_*` in Carbon's Events.h).
fn mac_key_code(usage: u8) -> Option<u16> {
    const LETTERS: [u16; 26] = [
        0x00, 0x0b, 0x08, 0x02, 0x0e, 0x03, 0x05, 0x04, 0x22, 0x26, 0x28, 0x25, 0x2e, 0x2d, 0x1f,
        0x23, 0x0c, 0x0f, 0x01, 0x11, 0x20, 0x09, 0x0d, 0x07, 0x10, 0x06,
    ];
    // HID orders the digit row 1 to 9, then 0.
    const DIGITS: [u16; 10] = [0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1a, 0x1c, 0x19, 0x1d];
    const F_KEYS: [u16; 12] = [
        0x7a, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6d, 0x67, 0x6f,
    ];
    const KEYPAD_1_TO_9: [u16; 9] = [0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5b, 0x5c];

    let code = match usage {
        0x04..=0x1d => LETTERS[usize::from(usage - 0x04)],
        0x1e..=0x27 => DIGITS[usize::from(usage - 0x1e)],
        0x28 => 0x24,        // Return
        0x29 => 0x35,        // Escape
        0x2a => 0x33,        // Backspace
        0x2b => 0x30,        // Tab
        0x2c => 0x31,        // Space
        0x2d => 0x1b,        // -
        0x2e => 0x18,        // =
        0x2f => 0x21,        // [
        0x30 => 0x1e,        // ]
        0x31 | 0x32 => 0x2a, // \ and the ISO key beside Return
        0x33 => 0x29,        // ;
        0x34 => 0x27,        // '
        0x35 => 0x32,        // `
        0x36 => 0x2b,        // ,
        0x37 => 0x2f,        // .
        0x38 => 0x2c,        // /
        0x39 => 0x39,        // Caps Lock
        0x3a..=0x45 => F_KEYS[usize::from(usage - 0x3a)],
        0x49 => 0x72, // Insert, Help on Mac keyboards
        0x4a => 0x73, // Home
        0x4b => 0x74, // Page Up
        0x4c => 0x75, // Forward Delete
        0x4d => 0x77, // End
        0x4e => 0x79, // Page Down
        0x4f => 0x7c, // Right
        0x50 => 0x7b, // Left
        0x51 => 0x7d, // Down
        0x52 => 0x7e, // Up
        0x53 => 0x47, // Num Lock, Clear on Mac keypads
        0x54 => 0x4b, // Keypad /
        0x55 => 0x43, // Keypad *
        0x56 => 0x4e, // Keypad -
        0x57 => 0x45, // Keypad +
        0x58 => 0x4c, // Keypad Enter
        0x59..=0x61 => KEYPAD_1_TO_9[usize::from(usage - 0x59)],
        0x62 => 0x52, // Keypad 0
        0x63 => 0x41, // Keypad .
        0x64 => 0x0a, // ISO key beside left Shift
        0x67 => 0x51, // Keypad =
        0xe0 => 0x3b, // Left Control
        0xe1 => 0x38, // Left Shift
        0xe2 => 0x3a, // Left Option
        0xe3 => 0x37, // Left Command
        0xe4 => 0x3e, // Right Control
        0xe5 => 0x3c, // Right Shift
        0xe6 => 0x3d, // Right Option
        0xe7 => 0x36, // Right Command
        _ => return None,
    };
    Some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_keys_to_mac_key_codes() {
        // Reference values from Carbon's Events.h.
        assert_eq!(mac_key_code(0x04), Some(0x00)); // A
        assert_eq!(mac_key_code(0x1a), Some(0x0d)); // W
        assert_eq!(mac_key_code(0x1d), Some(0x06)); // Z
        assert_eq!(mac_key_code(0x1e), Some(0x12)); // 1
        assert_eq!(mac_key_code(0x27), Some(0x1d)); // 0
        assert_eq!(mac_key_code(0x2c), Some(0x31)); // Space
        assert_eq!(mac_key_code(0x3d), Some(0x76)); // F4
        assert_eq!(mac_key_code(0x52), Some(0x7e)); // Up
        assert_eq!(mac_key_code(0x61), Some(0x5c)); // Keypad 9
        assert_eq!(mac_key_code(0xe1), Some(0x38)); // Left Shift
        assert_eq!(mac_key_code(0x46), None); // Print Screen has no Mac key
    }

    #[test]
    fn modifiers_become_event_flags() {
        let flags = modifier_flags(&[0x1a, 0xe1, 0xe6]);
        assert_eq!(flags, CGEventFlags::MaskShift | CGEventFlags::MaskAlternate);
    }
}
