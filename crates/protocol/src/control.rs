//! JSON messages between the host and one guest, on the reliable `control` data channel.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum GuestControl {
    /// Clock probe. `t0` is the guest's Unix time in milliseconds when sent.
    Ping { t0: f64 },
    /// The guest unplugged a controller; its slot is freed.
    PadRemoved { pad: u8 },
    /// How the stream arrives, sent every second: video packets lost over that second, in
    /// thousandths, and the 95th percentile picture latency when the browser can measure it.
    Quality {
        loss_permille: u16,
        latency_ms: Option<u32>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum HostControl {
    /// What this host can do. Sent once the connection opens.
    HostInfo {
        /// Whether controllers are played into the game. False on macOS hosts, where
        /// keyboards still work but virtual controllers cannot exist.
        virtual_pads: bool,
    },
    /// Answer to [`GuestControl::Ping`]. `t1` is the host's Unix time in milliseconds.
    Pong { t0: f64, t1: f64 },
    /// Host Unix time, in milliseconds, of RTP timestamp 0 on the video track.
    /// RTP timestamps count at 90 kHz from there, so a guest can tell when any
    /// frame was captured.
    StreamClock { epoch_ms: u64 },
    /// Controller `pad` of this guest now drives player `slot` (1 to 8).
    Slot { pad: u8, slot: u8 },
    /// Keyboard input is held back, because the game window lost focus on the host.
    InputPaused { paused: bool },
    /// The game closed on the host's computer. The room stays open, and the stream comes
    /// back with `closed: false` once the game does.
    GameClosed { closed: bool },
}
