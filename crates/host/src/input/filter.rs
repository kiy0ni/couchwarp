//! Keys a guest may never send, alone or in a combination: anything that would take
//! them out of the game and onto the host's desktop. Filtering happens before
//! injection, so a blocked key is never pressed at all.

use couchwarp_protocol::input::Buttons;

mod usage {
    pub const ESCAPE: u8 = 0x29;
    pub const TAB: u8 = 0x2b;
    pub const SPACE: u8 = 0x2c;
    pub const F4: u8 = 0x3d;
    pub const PRINT_SCREEN: u8 = 0x46;
    pub const DELETE: u8 = 0x4c;
    pub const LEFT_CONTROL: u8 = 0xe0;
    pub const LEFT_ALT: u8 = 0xe2;
    /// Windows key on PC keyboards, Command on Mac keyboards.
    pub const LEFT_GUI: u8 = 0xe3;
    pub const RIGHT_CONTROL: u8 = 0xe4;
    pub const RIGHT_ALT: u8 = 0xe6;
    pub const RIGHT_GUI: u8 = 0xe7;
}

use usage::*;

/// The subset of `held` that may reach the game.
///
/// - Windows/Command and Print Screen never pass: they open the Start menu, the Mac
///   menu shortcuts (Cmd+Q, Cmd+Tab) or screenshot tools.
/// - With Alt held, Tab, F4, Escape and Space are dropped (window switching, closing,
///   the window menu).
/// - With Control held, Escape is dropped (Start menu, Task Manager), and so is Delete
///   when Alt is held too.
pub fn allowed_keys(held: &[u8]) -> Vec<u8> {
    let alt = held.iter().any(|&key| key == LEFT_ALT || key == RIGHT_ALT);
    let control = held
        .iter()
        .any(|&key| key == LEFT_CONTROL || key == RIGHT_CONTROL);

    held.iter()
        .copied()
        .filter(|&key| match key {
            LEFT_GUI | RIGHT_GUI | PRINT_SCREEN => false,
            TAB | F4 | SPACE if alt => false,
            ESCAPE if alt || control => false,
            DELETE if alt && control => false,
            _ => true,
        })
        .collect()
}

/// Controller buttons a guest may never press. Guide opens the Xbox Game Bar or Steam.
pub fn allowed_buttons(buttons: Buttons) -> Buttons {
    buttons.without(Buttons::GUIDE)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY_W: u8 = 0x1a;
    const LEFT_SHIFT: u8 = 0xe1;

    #[test]
    fn game_keys_pass() {
        assert_eq!(
            allowed_keys(&[KEY_W, LEFT_SHIFT, SPACE, ESCAPE]),
            [KEY_W, LEFT_SHIFT, SPACE, ESCAPE]
        );
    }

    #[test]
    fn system_keys_never_pass() {
        assert_eq!(
            allowed_keys(&[LEFT_GUI, KEY_W, RIGHT_GUI, PRINT_SCREEN]),
            [KEY_W]
        );
    }

    #[test]
    fn alt_combinations_that_leave_the_game_are_cut() {
        assert_eq!(allowed_keys(&[LEFT_ALT, TAB]), [LEFT_ALT]);
        assert_eq!(allowed_keys(&[RIGHT_ALT, F4]), [RIGHT_ALT]);
        assert_eq!(allowed_keys(&[LEFT_ALT, ESCAPE]), [LEFT_ALT]);
        assert_eq!(allowed_keys(&[LEFT_ALT, SPACE]), [LEFT_ALT]);
        assert_eq!(allowed_keys(&[LEFT_ALT, KEY_W]), [LEFT_ALT, KEY_W]);
    }

    #[test]
    fn control_combinations_that_leave_the_game_are_cut() {
        assert_eq!(allowed_keys(&[LEFT_CONTROL, ESCAPE]), [LEFT_CONTROL]);
        assert_eq!(
            allowed_keys(&[LEFT_CONTROL, LEFT_SHIFT, ESCAPE]),
            [LEFT_CONTROL, LEFT_SHIFT]
        );
        assert_eq!(
            allowed_keys(&[RIGHT_CONTROL, LEFT_ALT, DELETE]),
            [RIGHT_CONTROL, LEFT_ALT]
        );
        assert_eq!(
            allowed_keys(&[LEFT_CONTROL, DELETE]),
            [LEFT_CONTROL, DELETE]
        );
    }

    #[test]
    fn the_guide_button_is_removed() {
        let held = Buttons(Buttons::A.0 | Buttons::GUIDE.0);
        assert_eq!(allowed_buttons(held), Buttons::A);
    }
}
