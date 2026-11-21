//! Guests' input as `uinput` devices, which games read like real hardware: one keyboard
//! and mouse for every guest's keys and pointer, and one Xbox 360 controller per player
//! slot, plugged in on first use and unplugged when dropped.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::fs::OpenOptions;
use std::io;

use couchwarp_protocol::input::{GamepadState, MotionState, MouseButtons};
use couchwarp_protocol::room::PadType;
use evdev::uinput::VirtualDevice;
use evdev::{
    AbsInfo, AbsoluteAxisCode, AttributeSet, BusType, InputEvent, InputId, KeyCode,
    RelativeAxisCode, UinputAbsSetup,
};
use tracing::warn;

use crate::input::{button_changes, key_changes};
use crate::linux_input::{
    ABS_HAT0X, ABS_HAT0Y, ABS_RX, ABS_RY, ABS_RZ, ABS_X, ABS_Y, ABS_Z, EV_KEY, EV_REL, Event,
    MOUSE_BUTTONS, PAD_BUTTONS, REL_WHEEL, REL_WHEEL_HI_RES, REL_X, REL_Y, Wheel, XBOX_360_ID,
    mouse_button_code, pad_events,
};
use crate::pc_keys::linux_keycode;

const UINPUT: &str = "/dev/uinput";

pub fn uinput_writable() -> bool {
    OpenOptions::new().write(true).open(UINPUT).is_ok()
}

/// Where guests' input ends up on this machine.
pub struct InputSink {
    /// None when `/dev/uinput` cannot be written: guests are told their input is off.
    desk: Option<VirtualDevice>,
    pads: HashMap<u8, VirtualDevice>,
    held_keys: Vec<u8>,
    held_buttons: MouseButtons,
    wheel: Wheel,
    /// Keeps the real pointer, which guests' mice move, inside the game window. None
    /// until a guest's mouse moves, or when X11 cannot do it.
    confinement: Option<super::x11::Confinement>,
    confinement_tried: bool,
}

impl InputSink {
    pub fn new(_game_pid: i32) -> Self {
        let desk = keyboard_and_mouse()
            .map_err(|error| {
                warn!(%error, "guests' keys, mice and controllers are off: {UINPUT} is not writable");
            })
            .ok();
        Self {
            desk,
            pads: HashMap::new(),
            held_keys: Vec::new(),
            held_buttons: MouseButtons::default(),
            wheel: Wheel::default(),
            confinement: None,
            confinement_tried: false,
        }
    }

    /// The game came back as another process. Input goes to the window in front, so
    /// nothing changes here.
    pub fn set_game(&mut self, _game_pid: i32) {}

    /// Guests' mice always move the real cursor here.
    pub fn set_system_pointer(&mut self, _on: bool) {}

    /// Controllers can be plugged in whenever `uinput` works.
    pub fn virtual_pads(&self) -> bool {
        self.desk.is_some()
    }

    pub fn set_keys(&mut self, keys: &[u8]) {
        let (released, pressed) = key_changes(&self.held_keys, keys);
        self.held_keys = keys.to_vec();
        let events: Vec<Event> = released
            .into_iter()
            .map(|usage| (usage, 0))
            .chain(pressed.into_iter().map(|usage| (usage, 1)))
            .filter_map(|(usage, value)| Some((EV_KEY, linux_keycode(usage)?, value)))
            .collect();
        self.send_desk(&events);
    }

    /// Every controller shows as an Xbox 360 pad, whatever the guest picked: Linux games
    /// read it everywhere, and it needs no driver.
    pub fn set_pad(&mut self, slot: u8, _pad_type: PadType, state: &GamepadState) {
        if self.desk.is_none() {
            return;
        }
        let pad = match self.pads.entry(slot) {
            Entry::Occupied(plugged) => plugged.into_mut(),
            Entry::Vacant(free) => match controller(slot) {
                Ok(device) => free.insert(device),
                Err(error) => {
                    warn!(slot, %error, "virtual controller not plugged in");
                    return;
                }
            },
        };
        if let Err(error) = pad.emit(&input_events(&pad_events(state))) {
            warn!(slot, %error, "controller state not delivered; unplugging it");
            self.pads.remove(&slot);
        }
    }

    /// Dropping the device unplugs it.
    pub fn release_pad(&mut self, slot: u8) {
        self.pads.remove(&slot);
    }

    /// An Xbox 360 controller has no motion sensors.
    pub fn set_motion(&mut self, _slot: u8, _motion: &MotionState) {}

    /// The pointer stays in the game window while guests' mice act, as on Windows: a
    /// click can never land in another window. The router only sends mouse input while
    /// the game is in front.
    fn confine(&mut self) {
        if !self.confinement_tried {
            self.confinement_tried = true;
            self.confinement = super::x11::Confinement::open();
        }
        if let Some(confinement) = &mut self.confinement {
            confinement.confine();
        }
    }

    pub fn move_mouse(&mut self, dx: i32, dy: i32) {
        self.confine();
        self.send_desk(&[(EV_REL, REL_X, dx), (EV_REL, REL_Y, dy)]);
    }

    pub fn set_mouse_buttons(&mut self, buttons: MouseButtons) {
        let events: Vec<Event> = button_changes(self.held_buttons, buttons)
            .into_iter()
            .filter_map(|(button, down)| {
                Some((EV_KEY, mouse_button_code(button)?, i32::from(down)))
            })
            .collect();
        self.held_buttons = buttons;
        self.send_desk(&events);
    }

    pub fn scroll(&mut self, wheel: i32) {
        let events = self.wheel.scroll(wheel);
        self.send_desk(&events);
    }

    /// The game went behind: buttons held by guests are let go, so nothing keeps dragging
    /// in another window. Keys are already released by the router.
    pub fn set_paused(&mut self, paused: bool) {
        if paused {
            self.set_mouse_buttons(MouseButtons::default());
            if let Some(confinement) = &mut self.confinement {
                confinement.release();
            }
        }
    }

    fn send_desk(&mut self, events: &[Event]) {
        let Some(desk) = &mut self.desk else { return };
        if events.is_empty() {
            return;
        }
        if let Err(error) = desk.emit(&input_events(events)) {
            warn!(%error, "guest input not delivered");
        }
    }
}

impl Drop for InputSink {
    fn drop(&mut self) {
        self.set_keys(&[]);
        self.set_mouse_buttons(MouseButtons::default());
    }
}

fn input_events(events: &[Event]) -> Vec<InputEvent> {
    events
        .iter()
        .map(|&(kind, code, value)| InputEvent::new(kind, code, value))
        .collect()
}

fn keyboard_and_mouse() -> io::Result<VirtualDevice> {
    let mut keys = AttributeSet::<KeyCode>::new();
    for code in (0..=u8::MAX)
        .filter_map(linux_keycode)
        .chain(MOUSE_BUTTONS.iter().map(|&(_, code)| code))
    {
        keys.insert(KeyCode(code));
    }
    let mut axes = AttributeSet::<RelativeAxisCode>::new();
    for code in [REL_X, REL_Y, REL_WHEEL, REL_WHEEL_HI_RES] {
        axes.insert(RelativeAxisCode(code));
    }
    VirtualDevice::builder()?
        .name("Couchwarp keyboard and mouse")
        .with_keys(&keys)?
        .with_relative_axes(&axes)?
        .build()
}

fn controller(slot: u8) -> io::Result<VirtualDevice> {
    let (vendor, product, version) = XBOX_360_ID;
    let mut buttons = AttributeSet::<KeyCode>::new();
    for &(_, code) in &PAD_BUTTONS {
        buttons.insert(KeyCode(code));
    }
    // The ranges, fuzz and dead zone `xpad` declares.
    let stick = AbsInfo::new(0, -32768, 32767, 16, 128, 0);
    let trigger = AbsInfo::new(0, 0, 255, 0, 0, 0);
    let hat = AbsInfo::new(0, -1, 1, 0, 0, 0);
    let name = format!("Couchwarp player {slot}");
    let mut builder = VirtualDevice::builder()?
        .name(&name)
        .input_id(InputId::new(BusType::BUS_USB, vendor, product, version))
        .with_keys(&buttons)?;
    for (axis, info) in [
        (ABS_X, stick),
        (ABS_Y, stick),
        (ABS_RX, stick),
        (ABS_RY, stick),
        (ABS_Z, trigger),
        (ABS_RZ, trigger),
        (ABS_HAT0X, hat),
        (ABS_HAT0Y, hat),
    ] {
        builder = builder.with_absolute_axis(&UinputAbsSetup::new(AbsoluteAxisCode(axis), info))?;
    }
    builder.build()
}
