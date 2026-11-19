//! Decides what guests' input does on the host: which player slot each controller
//! drives, which keys get pressed, and when the keyboard is held back.
//!
//! The router is pure: it turns packets and events into [`Action`]s, and the platform
//! layer carries them out. Every rule about isolation lives here, where it is tested.

pub mod filter;

use std::collections::{BTreeSet, HashMap};

use couchwarp_protocol::input::{GamepadState, InputPacket, is_newer};
use couchwarp_protocol::signal::GuestId;

use filter::{allowed_buttons, allowed_keys};

/// Player slots, numbered 1 to 8.
pub const SLOTS: u8 = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Tell `guest` that its controller `pad` now drives player `slot`.
    SlotAssigned {
        guest: GuestId,
        pad: u8,
        slot: u8,
    },
    SetPad {
        slot: u8,
        state: GamepadState,
    },
    ReleasePad {
        slot: u8,
    },
    /// Every key that must be held down on the host now, already filtered.
    SetKeys(Vec<u8>),
    /// Tell every guest whether their keyboard is held back.
    KeyboardPaused(bool),
}

pub struct InputRouter {
    /// Index `slot - 1` holds the guest controller driving that slot.
    slots: [Option<(GuestId, u8)>; SLOTS as usize],
    pad_seqs: HashMap<(GuestId, u8), u16>,
    keyboards: HashMap<GuestId, (u16, Vec<u8>)>,
    game_focused: bool,
    held_keys: Vec<u8>,
}

impl InputRouter {
    pub fn new(game_focused: bool) -> Self {
        Self {
            slots: [None; SLOTS as usize],
            pad_seqs: HashMap::new(),
            keyboards: HashMap::new(),
            game_focused,
            held_keys: Vec::new(),
        }
    }

    pub fn apply(&mut self, guest: GuestId, packet: InputPacket) -> Vec<Action> {
        let mut actions = Vec::new();
        match packet {
            InputPacket::Gamepad(mut state) => {
                let key = (guest, state.pad);
                if self.is_stale(self.pad_seqs.get(&key).copied(), state.seq) {
                    return actions;
                }
                self.pad_seqs.insert(key, state.seq);
                let Some(slot) = self.slot_for(guest, state.pad, &mut actions) else {
                    return actions;
                };
                state.buttons = allowed_buttons(state.buttons);
                actions.push(Action::SetPad { slot, state });
            }
            InputPacket::Keyboard(keyboard) => {
                let last = self.keyboards.get(&guest).map(|(seq, _)| *seq);
                if self.is_stale(last, keyboard.seq) {
                    return actions;
                }
                self.keyboards
                    .insert(guest, (keyboard.seq, allowed_keys(&keyboard.keys)));
                self.update_keys(&mut actions);
            }
        }
        actions
    }

    pub fn remove_pad(&mut self, guest: GuestId, pad: u8) -> Vec<Action> {
        self.pad_seqs.remove(&(guest, pad));
        self.free_slots(|owner| owner == (guest, pad))
    }

    pub fn remove_guest(&mut self, guest: GuestId) -> Vec<Action> {
        self.pad_seqs.retain(|(owner, _), _| *owner != guest);
        let mut actions = self.free_slots(|(owner, _)| owner == guest);
        self.keyboards.remove(&guest);
        self.update_keys(&mut actions);
        actions
    }

    /// While the game window is not in front, no guest key reaches the host: they would
    /// land in whatever window the host is using.
    pub fn set_game_focused(&mut self, focused: bool) -> Vec<Action> {
        let mut actions = Vec::new();
        if focused != self.game_focused {
            self.game_focused = focused;
            actions.push(Action::KeyboardPaused(!focused));
            self.update_keys(&mut actions);
        }
        actions
    }

    pub fn keyboard_paused(&self) -> bool {
        !self.game_focused
    }

    fn is_stale(&self, last: Option<u16>, seq: u16) -> bool {
        last.is_some_and(|last| !is_newer(seq, last))
    }

    fn slot_for(&mut self, guest: GuestId, pad: u8, actions: &mut Vec<Action>) -> Option<u8> {
        if let Some(index) = self.slots.iter().position(|s| *s == Some((guest, pad))) {
            return Some(index as u8 + 1);
        }
        let index = self.slots.iter().position(Option::is_none)?;
        self.slots[index] = Some((guest, pad));
        let slot = index as u8 + 1;
        actions.push(Action::SlotAssigned { guest, pad, slot });
        Some(slot)
    }

    fn free_slots(&mut self, matches: impl Fn((GuestId, u8)) -> bool) -> Vec<Action> {
        let mut actions = Vec::new();
        for (index, owner) in self.slots.iter_mut().enumerate() {
            if owner.is_some_and(&matches) {
                *owner = None;
                actions.push(Action::ReleasePad {
                    slot: index as u8 + 1,
                });
            }
        }
        actions
    }

    /// Several guests can hold the same key; it stays down until the last one lets go.
    fn update_keys(&mut self, actions: &mut Vec<Action>) {
        let wanted: Vec<u8> = if self.game_focused {
            let union: BTreeSet<u8> = self
                .keyboards
                .values()
                .flat_map(|(_, keys)| keys)
                .copied()
                .collect();
            union.into_iter().collect()
        } else {
            Vec::new()
        };
        if wanted != self.held_keys {
            self.held_keys.clone_from(&wanted);
            actions.push(Action::SetKeys(wanted));
        }
    }
}

/// Keys to release, then keys to press, to go from `held` to `wanted`.
pub fn key_changes(held: &[u8], wanted: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let released = held
        .iter()
        .copied()
        .filter(|key| !wanted.contains(key))
        .collect();
    let pressed = wanted
        .iter()
        .copied()
        .filter(|key| !held.contains(key))
        .collect();
    (released, pressed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use couchwarp_protocol::input::{Buttons, KeyboardState};

    const KEY_A: u8 = 0x04;
    const KEY_W: u8 = 0x1a;
    const LEFT_GUI: u8 = 0xe3;

    fn pad(pad: u8, seq: u16, buttons: Buttons) -> InputPacket {
        InputPacket::Gamepad(GamepadState {
            pad,
            seq,
            buttons,
            ..GamepadState::default()
        })
    }

    fn keys(seq: u16, keys: &[u8]) -> InputPacket {
        InputPacket::Keyboard(KeyboardState {
            seq,
            keys: keys.to_vec(),
        })
    }

    fn slots_assigned(actions: &[Action]) -> Vec<u8> {
        actions
            .iter()
            .filter_map(|a| match a {
                Action::SlotAssigned { slot, .. } => Some(*slot),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn controllers_take_the_lowest_free_slot() {
        let mut router = InputRouter::new(true);
        assert_eq!(slots_assigned(&router.apply(1, pad(0, 1, Buttons::A))), [1]);
        assert_eq!(slots_assigned(&router.apply(2, pad(0, 1, Buttons::A))), [2]);
        assert_eq!(slots_assigned(&router.apply(2, pad(1, 2, Buttons::A))), [3]);
        // Same controller again: same slot, nothing new to announce.
        assert!(slots_assigned(&router.apply(1, pad(0, 2, Buttons::B))).is_empty());

        assert_eq!(
            router.remove_guest(2),
            [
                Action::ReleasePad { slot: 2 },
                Action::ReleasePad { slot: 3 }
            ]
        );
        assert_eq!(slots_assigned(&router.apply(3, pad(0, 1, Buttons::A))), [2]);
    }

    #[test]
    fn a_ninth_controller_gets_nothing() {
        let mut router = InputRouter::new(true);
        for guest in 1..=8 {
            router.apply(guest, pad(0, 1, Buttons::A));
        }
        assert_eq!(router.apply(9, pad(0, 1, Buttons::A)), []);
    }

    #[test]
    fn late_packets_are_dropped() {
        let mut router = InputRouter::new(true);
        router.apply(1, pad(0, 10, Buttons::A));
        assert_eq!(router.apply(1, pad(0, 9, Buttons::B)), []);
        assert_eq!(router.apply(1, pad(0, 10, Buttons::B)), []);
        assert_eq!(
            router.apply(1, keys(5, &[KEY_W])),
            [Action::SetKeys(vec![KEY_W])]
        );
        assert_eq!(router.apply(1, keys(4, &[])), []);
    }

    #[test]
    fn the_guide_button_never_reaches_a_slot() {
        let mut router = InputRouter::new(true);
        let actions = router.apply(1, pad(0, 1, Buttons(Buttons::A.0 | Buttons::GUIDE.0)));
        let Some(Action::SetPad { state, .. }) = actions.last() else {
            panic!("expected a pad state, got {actions:?}");
        };
        assert_eq!(state.buttons, Buttons::A);
    }

    #[test]
    fn keys_from_several_guests_are_merged_and_filtered() {
        let mut router = InputRouter::new(true);
        router.apply(1, keys(1, &[KEY_W, LEFT_GUI]));
        assert_eq!(
            router.apply(2, keys(1, &[KEY_A, KEY_W])),
            [Action::SetKeys(vec![KEY_A, KEY_W])]
        );
        // Guest 1 lets go of W, guest 2 still holds it: nothing changes on the host.
        assert_eq!(router.apply(1, keys(2, &[])), []);
        assert_eq!(router.remove_guest(2), [Action::SetKeys(vec![])]);
    }

    #[test]
    fn losing_focus_releases_every_key_and_holds_new_ones_back() {
        let mut router = InputRouter::new(true);
        router.apply(1, keys(1, &[KEY_W]));
        assert_eq!(
            router.set_game_focused(false),
            [Action::KeyboardPaused(true), Action::SetKeys(vec![])]
        );
        assert_eq!(router.apply(1, keys(2, &[KEY_W, KEY_A])), []);
        assert!(router.keyboard_paused());
        assert_eq!(
            router.set_game_focused(true),
            [
                Action::KeyboardPaused(false),
                Action::SetKeys(vec![KEY_A, KEY_W])
            ]
        );
    }

    #[test]
    fn key_changes_release_before_pressing() {
        assert_eq!(
            key_changes(&[KEY_W, KEY_A], &[KEY_A, LEFT_GUI]),
            (vec![KEY_W], vec![LEFT_GUI])
        );
        assert_eq!(key_changes(&[], &[]), (vec![], vec![]));
    }

    #[test]
    fn controllers_keep_working_without_focus() {
        let mut router = InputRouter::new(false);
        let actions = router.apply(1, pad(0, 1, Buttons::A));
        assert!(matches!(
            actions.last(),
            Some(Action::SetPad { slot: 1, .. })
        ));
    }
}
