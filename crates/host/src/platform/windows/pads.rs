//! Virtual Xbox 360 controllers through VIIPER, one per player slot, created on first use.
//!
//! VIIPER is a separate service (USB/IP, with a signed driver) that the host talks to over
//! its local API. Without it, controllers are received but not played.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::net::SocketAddr;

use anyhow::{Context, Result};
use couchwarp_protocol::input::GamepadState;
use tracing::{info, warn};
use viiper_client::DeviceCreateRequest;
use viiper_client::client::{DeviceStream, ViiperClient};
use viiper_client::devices::xbox360::Xbox360Input;

use crate::xinput::xbox_report;

const VIIPER_API: &str = "127.0.0.1:3242";

struct VirtualPad {
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

    pub fn set(&mut self, slot: u8, state: &GamepadState) {
        let Some((client, bus)) = &self.service else {
            return;
        };
        if let Entry::Vacant(free) = self.pads.entry(slot) {
            match plug_in(client, *bus) {
                Ok(pad) => {
                    free.insert(pad);
                }
                Err(error) => {
                    warn!(slot, "{error:#}");
                    return;
                }
            }
        }
        let report = xbox_report(state);
        let input = Xbox360Input {
            buttons: report.buttons,
            lt: report.left_trigger,
            rt: report.right_trigger,
            lx: report.left_stick[0],
            ly: report.left_stick[1],
            rx: report.right_stick[0],
            ry: report.right_stick[1],
            reserved: [0; 6],
        };
        if let Some(pad) = self.pads.get_mut(&slot)
            && let Err(error) = pad.stream.send(&input)
        {
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

fn plug_in(client: &ViiperClient, bus: u32) -> Result<VirtualPad> {
    let request = DeviceCreateRequest {
        r#type: Some("xbox360".to_owned()),
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
        device_id: device.dev_id,
        stream,
    })
}
