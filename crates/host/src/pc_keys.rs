//! USB HID usages (keyboard page) to PC set 1 scancodes, the codes Windows games read,
//! and to Linux key codes, which follow set 1 except for the extended keys.

/// A scancode, and whether it needs the `0xE0` extended prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scancode {
    pub code: u16,
    pub extended: bool,
}

const fn plain(code: u16) -> Option<Scancode> {
    Some(Scancode {
        code,
        extended: false,
    })
}

const fn extended(code: u16) -> Option<Scancode> {
    Some(Scancode {
        code,
        extended: true,
    })
}

pub fn scancode(usage: u8) -> Option<Scancode> {
    const LETTERS: [u16; 26] = [
        0x1e, 0x30, 0x2e, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24, 0x25, 0x26, 0x32, 0x31, 0x18,
        0x19, 0x10, 0x13, 0x1f, 0x14, 0x16, 0x2f, 0x11, 0x2d, 0x15, 0x2c,
    ];
    const KEYPAD_1_TO_9: [u16; 9] = [0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49];

    match usage {
        0x04..=0x1d => plain(LETTERS[usize::from(usage - 0x04)]),
        // Digit row 1 to 9 then 0, in the same order as HID.
        0x1e..=0x27 => plain(0x02 + u16::from(usage - 0x1e)),
        0x28 => plain(0x1c),                                  // Enter
        0x29 => plain(0x01),                                  // Escape
        0x2a => plain(0x0e),                                  // Backspace
        0x2b => plain(0x0f),                                  // Tab
        0x2c => plain(0x39),                                  // Space
        0x2d => plain(0x0c),                                  // -
        0x2e => plain(0x0d),                                  // =
        0x2f => plain(0x1a),                                  // [
        0x30 => plain(0x1b),                                  // ]
        0x31 | 0x32 => plain(0x2b),                           // \ and the ISO key beside Enter
        0x33 => plain(0x27),                                  // ;
        0x34 => plain(0x28),                                  // '
        0x35 => plain(0x29),                                  // `
        0x36 => plain(0x33),                                  // ,
        0x37 => plain(0x34),                                  // .
        0x38 => plain(0x35),                                  // /
        0x39 => plain(0x3a),                                  // Caps Lock
        0x3a..=0x43 => plain(0x3b + u16::from(usage - 0x3a)), // F1 to F10
        0x44 => plain(0x57),                                  // F11
        0x45 => plain(0x58),                                  // F12
        0x47 => plain(0x46),                                  // Scroll Lock
        0x49 => extended(0x52),                               // Insert
        0x4a => extended(0x47),                               // Home
        0x4b => extended(0x49),                               // Page Up
        0x4c => extended(0x53),                               // Delete
        0x4d => extended(0x4f),                               // End
        0x4e => extended(0x51),                               // Page Down
        0x4f => extended(0x4d),                               // Right
        0x50 => extended(0x4b),                               // Left
        0x51 => extended(0x50),                               // Down
        0x52 => extended(0x48),                               // Up
        0x53 => plain(0x45),                                  // Num Lock
        0x54 => extended(0x35),                               // Keypad /
        0x55 => plain(0x37),                                  // Keypad *
        0x56 => plain(0x4a),                                  // Keypad -
        0x57 => plain(0x4e),                                  // Keypad +
        0x58 => extended(0x1c),                               // Keypad Enter
        0x59..=0x61 => plain(KEYPAD_1_TO_9[usize::from(usage - 0x59)]),
        0x62 => plain(0x52),    // Keypad 0
        0x63 => plain(0x53),    // Keypad .
        0x64 => plain(0x56),    // ISO key beside left Shift
        0x65 => extended(0x5d), // Menu
        0xe0 => plain(0x1d),    // Left Control
        0xe1 => plain(0x2a),    // Left Shift
        0xe2 => plain(0x38),    // Left Alt
        0xe3 => extended(0x5b), // Left Windows
        0xe4 => extended(0x1d), // Right Control
        0xe5 => plain(0x36),    // Right Shift
        0xe6 => extended(0x38), // Right Alt
        0xe7 => extended(0x5c), // Right Windows
        _ => None,
    }
}

/// The Linux key code (`KEY_*` in `input-event-codes.h`) for a HID usage. Plain set 1
/// scancodes are the Linux codes themselves; extended ones have codes of their own.
#[cfg(any(target_os = "linux", test))]
pub fn linux_keycode(usage: u8) -> Option<u16> {
    let key = scancode(usage)?;
    if !key.extended {
        return Some(key.code);
    }
    Some(match key.code {
        0x1c => 96,  // KEY_KPENTER
        0x1d => 97,  // KEY_RIGHTCTRL
        0x35 => 98,  // KEY_KPSLASH
        0x38 => 100, // KEY_RIGHTALT
        0x47 => 102, // KEY_HOME
        0x48 => 103, // KEY_UP
        0x49 => 104, // KEY_PAGEUP
        0x4b => 105, // KEY_LEFT
        0x4d => 106, // KEY_RIGHT
        0x4f => 107, // KEY_END
        0x50 => 108, // KEY_DOWN
        0x51 => 109, // KEY_PAGEDOWN
        0x52 => 110, // KEY_INSERT
        0x53 => 111, // KEY_DELETE
        0x5b => 125, // KEY_LEFTMETA
        0x5c => 126, // KEY_RIGHTMETA
        0x5d => 127, // KEY_COMPOSE
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_keys_to_set_one_scancodes() {
        // Reference: Microsoft's keyboard scan code specification, scan code set 1.
        assert_eq!(scancode(0x04), plain(0x1e)); // A
        assert_eq!(scancode(0x1a), plain(0x11)); // W
        assert_eq!(scancode(0x1d), plain(0x2c)); // Z
        assert_eq!(scancode(0x1e), plain(0x02)); // 1
        assert_eq!(scancode(0x27), plain(0x0b)); // 0
        assert_eq!(scancode(0x3d), plain(0x3e)); // F4
        assert_eq!(scancode(0x44), plain(0x57)); // F11
        assert_eq!(scancode(0x52), extended(0x48)); // Up
        assert_eq!(scancode(0x5c), plain(0x4b)); // Keypad 4
        assert_eq!(scancode(0xe6), extended(0x38)); // Right Alt
        assert_eq!(scancode(0x46), None); // Print Screen is never sent
    }

    #[test]
    fn maps_keys_to_linux_codes() {
        // Reference: linux/input-event-codes.h.
        assert_eq!(linux_keycode(0x04), Some(30)); // KEY_A
        assert_eq!(linux_keycode(0x29), Some(1)); // KEY_ESC
        assert_eq!(linux_keycode(0x45), Some(88)); // KEY_F12
        assert_eq!(linux_keycode(0x5c), Some(75)); // KEY_KP4
        assert_eq!(linux_keycode(0x52), Some(103)); // KEY_UP
        assert_eq!(linux_keycode(0x58), Some(96)); // KEY_KPENTER
        assert_eq!(linux_keycode(0xe4), Some(97)); // KEY_RIGHTCTRL
        assert_eq!(linux_keycode(0xe3), Some(125)); // KEY_LEFTMETA
        assert_eq!(linux_keycode(0x46), None);
        // Every key Windows can type, Linux can type too.
        for usage in 0..=u8::MAX {
            assert_eq!(
                scancode(usage).is_some(),
                linux_keycode(usage).is_some(),
                "{usage:#x}"
            );
        }
    }
}
