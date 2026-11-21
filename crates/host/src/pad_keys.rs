//! Controllers played as keys, where no virtual controller can exist (macOS hosts). Games
//! that two people play on one keyboard split it the same way: player 1 on the left with
//! WASD, player 2 on the right with the arrows and the keypad. Players 3 and up have no
//! keys left.
//!
//! The letters are positions, as USB keyboards number them: on a French keyboard, player
//! 1 moves with ZQSD.

use couchwarp_protocol::input::{Buttons, GamepadState};

/// How far a stick goes before it counts as a direction: half way.
const STICK_THRESHOLD: i32 = i16::MAX as i32 / 2;

/// The keys of one player: up, down, left, right, then each button's.
struct Layout {
    directions: [u8; 4],
    buttons: [(Buttons, u8); 8],
}

const PLAYER_1: Layout = Layout {
    // W, S, A, D
    directions: [0x1a, 0x16, 0x04, 0x07],
    buttons: [
        (Buttons::A, 0x2c),            // Space
        (Buttons::B, 0xe1),            // Left Shift
        (Buttons::X, 0x08),            // E
        (Buttons::Y, 0x14),            // Q
        (Buttons::LEFT_BUMPER, 0x1e),  // 1
        (Buttons::RIGHT_BUMPER, 0x1f), // 2
        (Buttons::START, 0x28),        // Return
        (Buttons::BACK, 0x29),         // Escape
    ],
};

const PLAYER_2: Layout = Layout {
    // Up, Down, Left, Right arrows
    directions: [0x52, 0x51, 0x50, 0x4f],
    buttons: [
        (Buttons::A, 0x59),            // Keypad 1
        (Buttons::B, 0x5a),            // Keypad 2
        (Buttons::X, 0x5c),            // Keypad 4
        (Buttons::Y, 0x5d),            // Keypad 5
        (Buttons::LEFT_BUMPER, 0x5f),  // Keypad 7
        (Buttons::RIGHT_BUMPER, 0x60), // Keypad 8
        (Buttons::START, 0x58),        // Keypad Enter
        (Buttons::BACK, 0x2a),         // Backspace
    ],
};

/// The keys `state` holds down for the player in `slot` (1 to 8).
pub fn keys_for(slot: u8, state: &GamepadState) -> Vec<u8> {
    let layout = match slot {
        1 => &PLAYER_1,
        2 => &PLAYER_2,
        _ => return Vec::new(),
    };
    let [x, y] = state.left_stick.map(i32::from);
    let held = |button| state.buttons.contains(button);
    let directions = [
        held(Buttons::DPAD_UP) || y < -STICK_THRESHOLD,
        held(Buttons::DPAD_DOWN) || y > STICK_THRESHOLD,
        held(Buttons::DPAD_LEFT) || x < -STICK_THRESHOLD,
        held(Buttons::DPAD_RIGHT) || x > STICK_THRESHOLD,
    ];
    let mut keys: Vec<u8> = layout
        .directions
        .iter()
        .zip(directions)
        .filter(|(_, down)| *down)
        .map(|(key, _)| *key)
        .collect();
    keys.extend(
        layout
            .buttons
            .iter()
            .filter(|(button, _)| held(*button))
            .map(|(_, key)| *key),
    );
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pad(buttons: Buttons, left_stick: [i16; 2]) -> GamepadState {
        GamepadState {
            buttons,
            left_stick,
            ..GamepadState::default()
        }
    }

    #[test]
    fn player_one_plays_on_the_left_of_the_keyboard() {
        let state = pad(Buttons(Buttons::A.0 | Buttons::DPAD_LEFT.0), [0, 0]);
        assert_eq!(keys_for(1, &state), [0x04, 0x2c]);
    }

    #[test]
    fn player_two_plays_with_the_arrows_and_the_keypad() {
        let state = pad(Buttons(Buttons::START.0), [0, i16::MAX]);
        assert_eq!(keys_for(2, &state), [0x51, 0x58]);
    }

    #[test]
    fn a_stick_counts_past_half_way_only() {
        assert!(keys_for(1, &pad(Buttons::default(), [10_000, -10_000])).is_empty());
        assert_eq!(
            keys_for(1, &pad(Buttons::default(), [20_000, -20_000])),
            [0x1a, 0x07]
        );
    }

    #[test]
    fn players_beyond_two_have_no_keys() {
        assert!(keys_for(3, &pad(Buttons(Buttons::A.0), [0, 0])).is_empty());
    }
}
