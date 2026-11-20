//! Controllers' motion sensors, read by the app itself. The page reads gyroscopes over
//! WebHID in Chrome and Edge, but the app's web view has no WebHID (WebKit on macOS and
//! Linux, WebView2 without a device picker on Windows). Here the app opens PlayStation and
//! Switch controllers as shared HID devices, so the page's Gamepad API keeps them too, and
//! hands their raw input reports to the page, which decodes them with the same code as
//! WebHID reports (`apps/web/src/lib/motion.ts`).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use hidapi::{DeviceInfo, HidApi, HidDevice};
use serde::Serialize;
use tauri::ipc::Channel;
use tracing::{info, warn};

const SONY: u16 = 0x054c;
const NINTENDO: u16 = 0x057e;
const DUALSENSE: [u16; 2] = [0x0ce6, 0x0df2];
/// Generic Desktop usage page; 0 when the system does not say.
const GENERIC_DESKTOP: [u16; 2] = [0x00, 0x01];
/// How often new controllers are looked for.
const LOOK_EVERY: Duration = Duration::from_secs(2);
/// Controllers report up to 1000 times a second; the page sends motion every 16 ms.
const SEND_EVERY: Duration = Duration::from_millis(8);
const READ_TIMEOUT_MS: i32 = 250;

/// One input report, as WebHID gives it: the report id apart, the rest as bytes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    vendor_id: u16,
    product_id: u16,
    report_id: u8,
    data: Vec<u8>,
}

#[derive(Default)]
struct Shared {
    /// Where reports go: the page that asked last. Replaced when the page reloads.
    page: Mutex<Option<Channel<Report>>>,
    /// Controllers being read, by device path, with their names.
    open: Mutex<HashMap<String, String>>,
}

static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();

/// Sends this page every controller's reports from now on, starting the reading once.
pub fn watch(page: Channel<Report>) {
    let mut started = false;
    let shared = SHARED.get_or_init(|| {
        started = true;
        Arc::new(Shared::default())
    });
    *shared.page.lock().expect("never poisoned") = Some(page);
    if started {
        let shared = shared.clone();
        thread::Builder::new()
            .name("controllers".to_owned())
            .spawn(move || look_for_controllers(&shared))
            .expect("a thread can always be started at launch");
    }
}

/// The names of the controllers whose motion is read now.
pub fn controllers() -> Vec<String> {
    SHARED.get().map_or_else(Vec::new, |shared| {
        let mut names: Vec<String> = shared
            .open
            .lock()
            .expect("never poisoned")
            .values()
            .cloned()
            .collect();
        names.sort();
        names
    })
}

fn look_for_controllers(shared: &Arc<Shared>) {
    let mut api = match HidApi::new() {
        Ok(api) => api,
        Err(error) => {
            warn!(%error, "controllers' motion cannot be read on this computer");
            return;
        }
    };
    loop {
        if let Err(error) = api.refresh_devices() {
            warn!(%error, "could not list controllers");
        }
        let found: Vec<DeviceInfo> = api.device_list().filter(|d| wanted(d)).cloned().collect();
        for device in found {
            let path = device.path().to_string_lossy().into_owned();
            if shared
                .open
                .lock()
                .expect("never poisoned")
                .contains_key(&path)
            {
                continue;
            }
            match api.open_path(device.path()) {
                Ok(handle) => start_reading(shared, path, &device, handle),
                // Another app may hold it, or it went away since the list was made.
                Err(error) => warn!(%error, %path, "controller not opened"),
            }
        }
        thread::sleep(LOOK_EVERY);
    }
}

fn wanted(device: &DeviceInfo) -> bool {
    [SONY, NINTENDO].contains(&device.vendor_id()) && GENERIC_DESKTOP.contains(&device.usage_page())
}

fn start_reading(shared: &Arc<Shared>, path: String, device: &DeviceInfo, handle: HidDevice) {
    let name = device
        .product_string()
        .filter(|name| !name.is_empty())
        .unwrap_or("Controller")
        .to_owned();
    info!(%name, "reading the controller's motion");
    shared
        .open
        .lock()
        .expect("never poisoned")
        .insert(path.clone(), name);
    let (vendor_id, product_id) = (device.vendor_id(), device.product_id());
    let shared = shared.clone();
    let started = thread::Builder::new()
        .name("controller".to_owned())
        .spawn(move || {
            ask_for_motion(&handle, vendor_id, product_id);
            read(&shared, &handle, vendor_id, product_id);
            shared.open.lock().expect("never poisoned").remove(&path);
        });
    if let Err(error) = started {
        warn!(%error, "could not read the controller");
    }
}

/// Reads until the controller goes away, passing on at most one report every `SEND_EVERY`.
fn read(shared: &Shared, handle: &HidDevice, vendor_id: u16, product_id: u16) {
    let mut buffer = [0u8; 128];
    let mut sent_at: Option<Instant> = None;
    loop {
        let length = match handle.read_timeout(&mut buffer, READ_TIMEOUT_MS) {
            Ok(0) => continue,
            Ok(length) => length,
            // Unplugged, or switched off.
            Err(_) => return,
        };
        if sent_at.is_some_and(|at| at.elapsed() < SEND_EVERY) {
            continue;
        }
        sent_at = Some(Instant::now());
        let report = Report {
            vendor_id,
            product_id,
            report_id: buffer[0],
            data: buffer[1..length].to_vec(),
        };
        if let Some(page) = shared.page.lock().expect("never poisoned").as_ref() {
            // A page being reloaded drops its channel; the next one registers again.
            let _ = page.send(report);
        }
    }
}

/// Sony controllers over Bluetooth send short reports, without motion, until their
/// calibration is read once. Nintendo controllers send motion only once asked.
fn ask_for_motion(handle: &HidDevice, vendor_id: u16, product_id: u16) {
    if vendor_id == SONY {
        let mut calibration = [0u8; 64];
        calibration[0] = if DUALSENSE.contains(&product_id) {
            0x05
        } else {
            0x02
        };
        // Over USB the reports are complete anyway, and some clones refuse the request.
        let _ = handle.get_feature_report(&mut calibration);
    } else if vendor_id == NINTENDO {
        // Sensors on, then the full report mode that carries them.
        for (packet, (command, argument)) in
            [(0x40u8, 0x01u8), (0x03, 0x30)].into_iter().enumerate()
        {
            let mut report = [0u8; 49];
            report[0] = 0x01;
            report[1] = packet as u8;
            // A neutral rumble, as the protocol wants one before each subcommand.
            report[2..10].copy_from_slice(&[0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40]);
            report[10] = command;
            report[11] = argument;
            if let Err(error) = handle.write(&report) {
                warn!(%error, "the Nintendo controller did not turn its sensors on");
            }
        }
    }
}
