//! One hosting session, from opening the room to closing it: capture, encoding, the
//! connections to guests. It reports what happens through [`Event`]s and stops when the
//! `stop` future given to [`run`] completes, when the room is closed from the console, or
//! when the shared window goes away.

use std::future::Future;
use std::sync::Arc;

use anyhow::Result;
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::host::{Game, Host, Outputs, SettingsRequest};
use crate::platform::capture::{Capture, GameWindow};
use crate::platform::encoder::{Encoder, EncoderSettings};
use crate::{account, net, platform, signaling, thumbnail, video};

/// Frames waiting for the network. Beyond this the encoder drops instead of queuing.
const FRAME_QUEUE: usize = 4;
/// Sound packets waiting for the network: 80 ms.
const SOUND_QUEUE: usize = 8;

#[derive(Debug, Clone)]
pub struct Options {
    /// Address of the Couchwarp site, as guests open it.
    pub server: String,
    pub fps: u32,
    /// Highest video bitrate, in megabits per second; it drops to fit the slowest guest.
    pub bitrate_mbps: u32,
    /// Tallest picture sent, in pixels.
    pub max_height: u32,
    /// UDP port for guests; 0 picks a free one.
    pub port: u16,
    /// STUN server used to find this machine's public address.
    pub stun: String,
    /// Keep sending guests' keys while the game window is in the background (macOS only).
    pub ignore_focus: bool,
    pub settings: SettingsRequest,
}

impl Options {
    pub fn new(server: impl Into<String>) -> Self {
        Self {
            server: server.into(),
            fps: 60,
            bitrate_mbps: 12,
            max_height: 1080,
            port: 0,
            stun: "stun.cloudflare.com:3478".to_owned(),
            ignore_focus: false,
            settings: SettingsRequest::default(),
        }
    }
}

/// Something worth telling the person hosting.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// The room is open: guests join with the code, the host manages it with the key.
    Opened { code: String, console_key: String },
    /// Every two seconds while streaming.
    Stats(Stats),
    /// Guests' keyboards and mice cannot reach the game until the system allows it.
    NoInputPermission,
    /// The room was asked to be public, but the host is not signed in.
    PublicNeedsAccount,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stats {
    pub fps: f64,
    /// Capture to network, the host's share of the latency guests see.
    pub median_ms: f64,
    pub p95_ms: f64,
    pub bitrate: u32,
    /// Guests whose video connection is up.
    pub guests: usize,
}

/// Streams `window` until `stop` completes or the session ends on its own. `token` is the
/// signed-in account's session, if any: the room then carries its name.
pub async fn run(
    window: &GameWindow,
    options: Options,
    token: Option<String>,
    events: mpsc::UnboundedSender<Event>,
    stop: impl Future<Output = ()>,
) -> Result<()> {
    if options.ignore_focus && !platform::KEYS_REACH_GAME_ONLY {
        anyhow::bail!(
            "ignoring the focus is unsafe on this system: keys would go to whatever window \
             is in front"
        );
    }
    info!(app = %window.app, title = %window.title, "sharing this window");
    if !platform::can_send_keys() {
        let _ = events.send(Event::NoInputPermission);
    }

    let endpoint = net::open_endpoint(options.port, &options.stun)?;
    endpoint.socket.set_nonblocking(true)?;
    let socket = tokio::net::UdpSocket::from_std(endpoint.socket)?;
    info!(address = %socket.local_addr()?, "listening for guests");

    if options.settings.public && token.is_none() {
        let _ = events.send(Event::PublicNeedsAccount);
    }
    let room = signaling::open_room(&options.server, token.as_deref()).await?;
    let _ = events.send(Event::Opened {
        code: room.code.clone(),
        console_key: room.console_key.clone(),
    });

    let (frame_tx, frames) = mpsc::channel(FRAME_QUEUE);
    let bitrate = options.bitrate_mbps * 1_000_000;
    let control = video::EncoderControl::new(bitrate);
    let size = window.stream_size(options.max_height);
    let encoder = Arc::new(Encoder::new(
        &EncoderSettings {
            width: size.0,
            height: size.1,
            fps: options.fps,
            bitrate,
        },
        frame_tx,
        control.clone(),
    )?);
    let (sound_tx, sound) = mpsc::channel(SOUND_QUEUE);
    let (stopped_tx, capture_stopped) = mpsc::unbounded_channel();
    let thumbnails = Arc::new(thumbnail::Thumbnails::new(room.thumbnails.clone()));
    let _capture = Capture::start(
        window,
        size,
        options.fps,
        encoder,
        thumbnails.clone(),
        sound_tx,
        stopped_tx,
    )?;
    info!(
        width = size.0,
        height = size.1,
        fps = options.fps,
        "capture started"
    );

    let signal_out = room.outgoing.clone();
    Host::new(
        socket,
        endpoint.candidates,
        Game {
            pid: window.pid,
            focus_lock: !options.ignore_focus,
        },
        control,
        options.settings,
        Outputs {
            signal_out,
            thumbnails,
            events,
        },
    )
    .run(room, frames, sound, capture_stopped, stop)
    .await
}

/// The saved session for `server`, if the server still accepts it. An expired one is
/// forgotten.
pub fn saved_token(server: &str) -> Option<String> {
    let token = account::token(server)?;
    match account::display_name(server, &token) {
        Ok(Some(name)) => {
            info!(%name, "signed in");
            Some(token)
        }
        Ok(None) => {
            warn!("the saved session has expired: sign in again");
            if let Err(error) = account::forget(server) {
                warn!(%error, "could not forget the expired session");
            }
            None
        }
        Err(error) => {
            warn!(%error, "could not check the saved session; trying it anyway");
            Some(token)
        }
    }
}
