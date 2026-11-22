//! Virtual controllers through VIIPER, one per player slot: an Xbox 360 controller, or a
//! DualShock 4 for a guest who picked PlayStation.
//!
//! A slot's controller is plugged in as soon as a player is there to use it, and stays
//! until the game ends, at rest between players. Emulators and many games bind a player to
//! one controller: it must be there to be picked in their settings, and stay the same one
//! when a guest reconnects or another takes the seat.
//!
//! VIIPER is a separate service (USB/IP, with a signed driver) that the host talks to over
//! its local API. Without it, controllers are received but not played.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::net::SocketAddr;

use anyhow::{Context, Result};
use couchwarp_protocol::input::{GamepadState, MotionState};
use couchwarp_protocol::room::PadType;
use tracing::{info, warn};
use viiper_client::DeviceCreateRequest;
use viiper_client::client::{DeviceStream, ViiperClient};
use viiper_client::devices::dualshock4::{DEFAULT_ACCEL_Z_RAW, Dualshock4Input};
use viiper_client::devices::xbox360::Xbox360Input;

use crate::ds4::ds4_report;
use crate::xinput::xbox_report;

const VIIPER_API: &str = "127.0.0.1:3242";

struct VirtualPad {
    pad_type: PadType,
    device_id: String,
    stream: DeviceStream,
    /// The last buttons and sticks, sent again with each new motion.
    state: GamepadState,
    /// How the guest's controller moves; a DualShock 4 reports it, an Xbox 360 cannot.
    motion: Option<MotionState>,
}

pub struct PadSink {
    service: Option<(ViiperClient, u32)>,
    pads: HashMap<u8, VirtualPad>,
}

impl PadSink {
    pub fn connect() -> Self {
        let service = match open_bus() {
            Ok(service) => {
                info!("VIIPER ready: guests' controllers play into the game");
                Some(service)
            }
            Err(error) => {
                warn!(
                    "{error:#}. Controllers are disabled until VIIPER runs \
                     (https://alia5.github.io/VIIPER/)"
                );
                None
            }
        };
        Self {
            service,
            pads: HashMap::new(),
        }
    }

    pub fn available(&self) -> bool {
        self.service.is_some()
    }

    /// Plugs in an Xbox 360 controller for each of the first `count` slots that has none,
    /// before anyone presses anything.
    pub fn prepare(&mut self, count: u8) {
        for slot in 1..=count {
            if !self.pads.contains_key(&slot) {
                self.set(slot, PadType::Xbox360, &GamepadState::default());
            }
        }
    }

    /// A guest who changes controller type gets the new one plugged in instead.
    pub fn set(&mut self, slot: u8, pad_type: PadType, state: &GamepadState) {
        if self
            .pads
            .get(&slot)
            .is_some_and(|pad| pad.pad_type != pad_type)
        {
            self.unplug(slot);
        }
        let Some((client, bus)) = &self.service else {
            return;
        };
        if let Entry::Vacant(free) = self.pads.entry(slot) {
            match plug_in(client, *bus, pad_type) {
                Ok(pad) => {
                    free.insert(pad);
                }
                Err(error) => {
                    warn!(slot, "{error:#}");
                    return;
                }
            }
        }
        let Some(pad) = self.pads.get_mut(&slot) else {
            return;
        };
        pad.state = *state;
        self.send(slot);
    }

    /// Motion only changes a controller that already plays.
    pub fn set_motion(&mut self, slot: u8, motion: &MotionState) {
        let Some(pad) = self.pads.get_mut(&slot) else {
            return;
        };
        if pad.pad_type != PadType::DualShock4 {
            return;
        }
        pad.motion = Some(*motion);
        self.send(slot);
    }

    fn send(&mut self, slot: u8) {
        let Some(pad) = self.pads.get_mut(&slot) else {
            return;
        };
        let sent = match pad.pad_type {
            PadType::Xbox360 => pad.stream.send(&xbox_input(&pad.state)),
            PadType::DualShock4 => pad
                .stream
                .send(&dualshock_input(&pad.state, pad.motion.as_ref())),
        };
        if let Err(error) = sent {
            warn!(slot, %error, "controller state not delivered; unplugging it");
            self.unplug(slot);
        }
    }

    /// The slot's player is gone: its controller rests, plugged in, for the next one.
    pub fn release(&mut self, slot: u8) {
        let Some(pad) = self.pads.get_mut(&slot) else {
            return;
        };
        pad.state = GamepadState::default();
        pad.motion = None;
        self.send(slot);
    }

    fn unplug(&mut self, slot: u8) {
        let (Some((client, bus)), Some(pad)) = (&self.service, self.pads.remove(&slot)) else {
            return;
        };
        if let Err(error) = client.bus_device_remove(*bus, Some(&pad.device_id)) {
            warn!(slot, %error, "virtual controller not unplugged");
        }
    }
}

impl Drop for PadSink {
    fn drop(&mut self) {
        let slots: Vec<u8> = self.pads.keys().copied().collect();
        for slot in slots {
            self.unplug(slot);
        }
    }
}

fn open_bus() -> Result<(ViiperClient, u32)> {
    let address: SocketAddr = VIIPER_API.parse().expect("constant address");
    let client = ViiperClient::new(address);
    client
        .ping()
        .with_context(|| format!("no VIIPER service at {VIIPER_API}"))?;
    let existing = client.bus_list().context("VIIPER bus list failed")?;
    let bus = match existing.buses.first() {
        Some(&bus) => bus,
        None => {
            client
                .bus_create(None)
                .context("VIIPER bus creation failed")?
                .bus_id
        }
    };
    Ok((client, bus))
}

fn xbox_input(state: &GamepadState) -> Xbox360Input {
    let report = xbox_report(state);
    Xbox360Input {
        buttons: report.buttons,
        lt: report.left_trigger,
        rt: report.right_trigger,
        lx: report.left_stick[0],
        ly: report.left_stick[1],
        rx: report.right_stick[0],
        ry: report.right_stick[1],
        reserved: [0; 6],
    }
}

fn dualshock_input(state: &GamepadState, motion: Option<&MotionState>) -> Dualshock4Input {
    let report = ds4_report(state);
    let still = Dualshock4Input {
        stick_lx: report.left_stick[0],
        stick_ly: report.left_stick[1],
        stick_rx: report.right_stick[0],
        stick_ry: report.right_stick[1],
        buttons: report.buttons,
        dpad: report.dpad,
        trigger_l2: report.left_trigger,
        trigger_r2: report.right_trigger,
        // Lying flat and still: no touch, no motion, gravity straight down.
        accel_z: DEFAULT_ACCEL_Z_RAW,
        ..Dualshock4Input::default()
    };
    match motion {
        Some(motion) => Dualshock4Input {
            gyro_x: motion.gyro[0],
            gyro_y: motion.gyro[1],
            gyro_z: motion.gyro[2],
            accel_x: motion.accel[0],
            accel_y: motion.accel[1],
            accel_z: motion.accel[2],
            ..still
        },
        None => still,
    }
}

fn plug_in(client: &ViiperClient, bus: u32, pad_type: PadType) -> Result<VirtualPad> {
    let kind = match pad_type {
        PadType::Xbox360 => "xbox360",
        PadType::DualShock4 => "dualshock4",
    };
    let request = DeviceCreateRequest {
        r#type: Some(kind.to_owned()),
        id_vendor: None,
        id_product: None,
        device_specific: None,
    };
    let device = client
        .bus_device_add(bus, &request)
        .context("VIIPER refused a new controller")?;
    let stream = client
        .connect_device(device.bus_id, &device.dev_id)
        .context("cannot open the virtual controller")?;
    Ok(VirtualPad {
        pad_type,
        device_id: device.dev_id,
        stream,
        state: GamepadState::default(),
        motion: None,
    })
}
