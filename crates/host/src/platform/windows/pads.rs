//! Virtual controllers through VIIPER, one per player slot, created on first use: an Xbox
//! 360 controller, or a DualShock 4 for a guest who picked PlayStation.
//!
//! VIIPER is a separate service (USB/IP, with a signed driver) that the host talks to over
//! its local API. Without it, controllers are received but not played.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::net::SocketAddr;

use anyhow::{Context, Result};
use couchwarp_protocol::input::GamepadState;
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

    /// A guest who changes controller type gets the new one plugged in instead.
    pub fn set(&mut self, slot: u8, pad_type: PadType, state: &GamepadState) {
        if self
            .pads
            .get(&slot)
            .is_some_and(|pad| pad.pad_type != pad_type)
        {
            self.release(slot);
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
        let sent = match pad_type {
            PadType::Xbox360 => pad.stream.send(&xbox_input(state)),
            PadType::DualShock4 => pad.stream.send(&dualshock_input(state)),
        };
        if let Err(error) = sent {
            warn!(slot, %error, "controller state not delivered; unplugging it");
            self.release(slot);
        }
    }

    pub fn release(&mut self, slot: u8) {
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
            self.release(slot);
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

fn dualshock_input(state: &GamepadState) -> Dualshock4Input {
    let report = ds4_report(state);
    Dualshock4Input {
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
    })
}
