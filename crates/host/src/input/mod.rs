//! Decides what guests' input does on the host: which player slot each controller
//! drives, which keys get pressed, and when the keyboard is held back. Spectators send
//! nothing, and a guest's keyboard counts only once the host allows it.
//!
//! The router is pure: it turns packets and events into [`Action`]s, and the platform
//! layer carries them out. Every rule about isolation lives here, where it is tested.

pub mod filter;

use std::collections::{BTreeSet, HashMap};

use couchwarp_protocol::input::{GamepadState, InputPacket, MouseButtons, is_newer};
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
    /// Relative pointer movement, in pixels.
    MoveMouse {
        dx: i32,
        dy: i32,
    },
    /// Every mouse button that must be held down now, across guests.
    SetMouseButtons(MouseButtons),
    /// Wheel movement in 1/120ths of a notch, positive down.
    Scroll(i32),
    /// Tell every guest whether their keyboard is held back.
    KeyboardPaused(bool),
}

/// What a guest may send, from the room state. A guest not known yet may send nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Permissions {
    pub pads: bool,
    pub keyboard: bool,
    pub mouse: bool,
}

pub struct InputRouter {
    /// Index `slot - 1` holds the guest controller driving that slot.
    slots: [Option<(GuestId, u8)>; SLOTS as usize],
    permissions: HashMap<GuestId, Permissions>,
    pad_seqs: HashMap<(GuestId, u8), u16>,
    keyboards: HashMap<GuestId, (u16, Vec<u8>)>,
    mice: HashMap<GuestId, (u16, MouseButtons)>,
    game_focused: bool,
    held_keys: Vec<u8>,
    held_buttons: MouseButtons,
}

impl InputRouter {
    pub fn new(game_focused: bool) -> Self {
        Self {
            slots: [None; SLOTS as usize],
            permissions: HashMap::new(),
            pad_seqs: HashMap::new(),
            keyboards: HashMap::new(),
            mice: HashMap::new(),
            game_focused,
            held_keys: Vec::new(),
            held_buttons: MouseButtons::default(),
        }
    }

    pub fn apply(&mut self, guest: GuestId, packet: InputPacket) -> Vec<Action> {
        let mut actions = Vec::new();
        let allowed = self.permissions.get(&guest).copied().unwrap_or_default();
        match packet {
            InputPacket::Gamepad(_) if !allowed.pads => {}
            InputPacket::Keyboard(_) if !allowed.keyboard => {}
            InputPacket::Mouse(_) if !allowed.mouse => {}
            InputPacket::Mouse(mouse) => {
                let last = self.mice.get(&guest).map(|(seq, _)| *seq);
                if self.is_stale(last, mouse.seq) {
                    return actions;
                }
                self.mice.insert(guest, (mouse.seq, mouse.buttons));
                // Movement while the game is in the background would go to whatever is in
                // front: it is dropped, not saved for later.
                if self.game_focused {
                    if mouse.dx != 0 || mouse.dy != 0 {
                        actions.push(Action::MoveMouse {
                            dx: i32::from(mouse.dx),
                            dy: i32::from(mouse.dy),
                        });
                    }
                    if mouse.wheel != 0 {
                        actions.push(Action::Scroll(i32::from(mouse.wheel)));
                    }
                }
                self.update_buttons(&mut actions);
            }
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

    /// Applies what the room now allows `guest`, letting go of whatever it no longer may hold.
    pub fn set_permissions(&mut self, guest: GuestId, permissions: Permissions) -> Vec<Action> {
        let mut actions = Vec::new();
        self.permissions.insert(guest, permissions);
        if !permissions.pads {
            self.pad_seqs.retain(|(owner, _), _| *owner != guest);
            actions.extend(self.free_slots(|(owner, _)| owner == guest));
        }
        if !permissions.keyboard && self.keyboards.remove(&guest).is_some() {
            self.update_keys(&mut actions);
        }
        if !permissions.mouse && self.mice.remove(&guest).is_some() {
            self.update_buttons(&mut actions);
        }
        actions
    }

    /// The guest left the room: its connection, slots, keys and permissions all go.
    pub fn forget_guest(&mut self, guest: GuestId) -> Vec<Action> {
        self.permissions.remove(&guest);
        self.remove_guest(guest)
    }

    pub fn remove_pad(&mut self, guest: GuestId, pad: u8) -> Vec<Action> {
        self.pad_seqs.remove(&(guest, pad));
        self.free_slots(|owner| owner == (guest, pad))
    }

    /// The guest's connection is gone. Its permissions stay until it leaves the room.
    pub fn remove_guest(&mut self, guest: GuestId) -> Vec<Action> {
        self.pad_seqs.retain(|(owner, _), _| *owner != guest);
        let mut actions = self.free_slots(|(owner, _)| owner == guest);
        self.keyboards.remove(&guest);
        self.mice.remove(&guest);
        self.update_keys(&mut actions);
        self.update_buttons(&mut actions);
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
            self.update_buttons(&mut actions);
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

    /// A button stays down while any guest holds it, and never while the game is behind.
    fn update_buttons(&mut self, actions: &mut Vec<Action>) {
        let wanted = if self.game_focused {
            MouseButtons(self.mice.values().fold(0, |bits, (_, held)| bits | held.0))
        } else {
            MouseButtons::default()
        };
        if wanted != self.held_buttons {
            self.held_buttons = wanted;
            actions.push(Action::SetMouseButtons(wanted));
        }
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

/// The mouse buttons, one at a time, each with whether it goes down, to go from `held`
/// to `wanted`. Releases come first.
pub fn button_changes(held: MouseButtons, wanted: MouseButtons) -> Vec<(MouseButtons, bool)> {
    const EACH: [MouseButtons; 5] = [
        MouseButtons::LEFT,
        MouseButtons::RIGHT,
        MouseButtons::MIDDLE,
        MouseButtons::BACK,
        MouseButtons::FORWARD,
    ];
    let released = EACH
        .iter()
        .filter(|button| held.contains(**button) && !wanted.contains(**button))
        .map(|button| (*button, false));
    let pressed = EACH
        .iter()
        .filter(|button| wanted.contains(**button) && !held.contains(**button))
        .map(|button| (*button, true));
    released.chain(pressed).collect()
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
    use couchwarp_protocol::input::{Buttons, KeyboardState, MouseState};

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

    fn mouse(seq: u16, buttons: u8, dx: i16) -> InputPacket {
        InputPacket::Mouse(MouseState {
            seq,
            buttons: MouseButtons(buttons),
            dx,
            ..MouseState::default()
        })
    }

    fn keys(seq: u16, keys: &[u8]) -> InputPacket {
        InputPacket::Keyboard(KeyboardState {
            seq,
            keys: keys.to_vec(),
        })
    }

    const EVERYTHING: Permissions = Permissions {
        pads: true,
        keyboard: true,
        mouse: true,
    };

    /// A router where guests 1 to 9 may send everything.
    fn router(game_focused: bool) -> InputRouter {
        let mut router = InputRouter::new(game_focused);
        for guest in 1..=9 {
            router.set_permissions(guest, EVERYTHING);
        }
        router
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
        let mut router = router(true);
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
        let mut router = router(true);
        for guest in 1..=8 {
            router.apply(guest, pad(0, 1, Buttons::A));
        }
        assert_eq!(router.apply(9, pad(0, 1, Buttons::A)), []);
    }

    #[test]
    fn late_packets_are_dropped() {
        let mut router = router(true);
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
        let mut router = router(true);
        let actions = router.apply(1, pad(0, 1, Buttons(Buttons::A.0 | Buttons::GUIDE.0)));
        let Some(Action::SetPad { state, .. }) = actions.last() else {
            panic!("expected a pad state, got {actions:?}");
        };
        assert_eq!(state.buttons, Buttons::A);
    }

    #[test]
    fn keys_from_several_guests_are_merged_and_filtered() {
        let mut router = router(true);
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
        let mut router = router(true);
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
    fn button_changes_release_before_pressing() {
        assert_eq!(
            button_changes(MouseButtons(0b011), MouseButtons(0b110)),
            [(MouseButtons::LEFT, false), (MouseButtons::MIDDLE, true)]
        );
        assert_eq!(button_changes(MouseButtons(1), MouseButtons(1)), []);
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
        let mut router = router(false);
        let actions = router.apply(1, pad(0, 1, Buttons::A));
        assert!(matches!(
            actions.last(),
            Some(Action::SetPad { slot: 1, .. })
        ));
    }

    #[test]
    fn unknown_guests_and_spectators_send_nothing() {
        let mut router = InputRouter::new(true);
        assert_eq!(router.apply(1, pad(0, 1, Buttons::A)), []);
        router.set_permissions(1, Permissions::default());
        assert_eq!(router.apply(1, keys(1, &[KEY_W])), []);
    }

    #[test]
    fn the_keyboard_waits_for_the_host() {
        let mut router = InputRouter::new(true);
        router.set_permissions(
            1,
            Permissions {
                pads: true,
                keyboard: false,
                mouse: false,
            },
        );
        assert_eq!(router.apply(1, keys(1, &[KEY_W])), []);
        router.set_permissions(1, EVERYTHING);
        assert_eq!(
            router.apply(1, keys(2, &[KEY_W])),
            [Action::SetKeys(vec![KEY_W])]
        );
    }

    #[test]
    fn taking_permissions_back_releases_what_was_held() {
        let mut router = router(true);
        router.apply(1, pad(0, 1, Buttons::A));
        router.apply(1, keys(1, &[KEY_W]));
        assert_eq!(
            router.set_permissions(1, Permissions::default()),
            [Action::ReleasePad { slot: 1 }, Action::SetKeys(vec![])]
        );
        assert_eq!(router.apply(1, pad(0, 2, Buttons::A)), []);
    }

    #[test]
    fn a_dropped_connection_keeps_permissions_until_the_guest_leaves() {
        let mut router = router(true);
        router.remove_guest(1);
        assert!(!slots_assigned(&router.apply(1, pad(0, 1, Buttons::A))).is_empty());
        router.forget_guest(1);
        assert_eq!(router.apply(1, pad(0, 2, Buttons::A)), []);
    }

    #[test]
    fn mice_move_the_pointer_and_share_buttons() {
        let mut router = router(true);
        assert_eq!(
            router.apply(1, mouse(1, 0b01, 5)),
            [
                Action::MoveMouse { dx: 5, dy: 0 },
                Action::SetMouseButtons(MouseButtons(0b01))
            ]
        );
        assert_eq!(
            router.apply(2, mouse(1, 0b10, 0)),
            [Action::SetMouseButtons(MouseButtons(0b11))]
        );
        assert_eq!(router.apply(1, mouse(0, 0, 9)), [], "late packet");
        assert_eq!(
            router.remove_guest(2),
            [Action::SetMouseButtons(MouseButtons(0b01))]
        );
    }

    #[test]
    fn the_mouse_needs_permission_and_the_game_in_front() {
        let mut router = InputRouter::new(true);
        router.set_permissions(
            1,
            Permissions {
                pads: true,
                keyboard: true,
                mouse: false,
            },
        );
        assert_eq!(router.apply(1, mouse(1, 1, 5)), []);

        let mut router = self::router(true);
        router.apply(1, mouse(1, 1, 0));
        assert_eq!(
            router.set_game_focused(false),
            [
                Action::KeyboardPaused(true),
                Action::SetMouseButtons(MouseButtons(0))
            ]
        );
        assert_eq!(router.apply(1, mouse(2, 1, 40)), []);
    }
}
