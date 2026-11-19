//! Plays guests' keys as hardware scancodes with SendInput, which games read the same way
//! as a real keyboard. The router only sends keys while the game window is in front.

use std::mem::size_of;

use tracing::warn;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
    KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, SendInput, VIRTUAL_KEY,
};

use crate::input::key_changes;
use crate::pc_keys::scancode;

#[derive(Default)]
pub struct KeyboardSink {
    held: Vec<u8>,
}

impl KeyboardSink {
    /// Presses and releases whatever differs between the keys held now and `keys`.
    pub fn set_keys(&mut self, keys: &[u8]) {
        let (released, pressed) = key_changes(&self.held, keys);
        self.held = keys.to_vec();
        for usage in released {
            post(usage, false);
        }
        for usage in pressed {
            post(usage, true);
        }
    }
}

impl Drop for KeyboardSink {
    fn drop(&mut self) {
        self.set_keys(&[]);
    }
}

fn post(usage: u8, down: bool) {
    let Some(key) = scancode(usage) else { return };
    let mut flags: KEYBD_EVENT_FLAGS = KEYEVENTF_SCANCODE;
    if key.extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    if !down {
        flags |= KEYEVENTF_KEYUP;
    }
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: key.code,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    // SAFETY: one fully initialized keyboard input, with its exact size.
    let sent = unsafe { SendInput(&[input], size_of::<INPUT>() as i32) };
    if sent != 1 {
        warn!(
            usage,
            "key not sent: Windows blocks input into windows run as administrator"
        );
    }
}
