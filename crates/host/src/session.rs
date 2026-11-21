//! One hosting session, from opening the room to closing it: capture, encoding, the
//! connections to guests. It reports what happens through [`Event`]s and stops when the
//! `stop` future given to [`run`] completes or when the room is closed from the console. If
//! the game closes, the room stays open: the session finds the game's new window when it
//! comes back, and gives up after [`GAME_WAIT`].

use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::host::{Game, GameChange, Host, Outputs, SettingsRequest};
use crate::platform::capture::{Capture, GameWindow, list_windows};
use crate::platform::encoder::{Encoder, EncoderSettings};
use crate::{account, net, platform, signaling, thumbnail, video};

/// Frames waiting for the network. Beyond this the encoder drops instead of queuing.
const FRAME_QUEUE: usize = 4;
/// Sound packets waiting for the network: 80 ms.
const SOUND_QUEUE: usize = 8;
/// How often the windows are looked through for the game, while it is closed.
const GAME_LOOK: Duration = Duration::from_secs(1);
/// How long a room waits for its game to come back before it closes.
pub const GAME_WAIT: Duration = Duration::from_secs(15 * 60);

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
    /// Whether guests' keyboards and mice can reach the game: sent at the start, then each
    /// time the system's answer changes (the host allowed Couchwarp in the settings).
    InputPermission { allowed: bool },
    /// Guests' keyboards and mice wait because the game window went behind another one.
    InputPaused { paused: bool },
    /// The room was asked to be public, but the host is not signed in.
    PublicNeedsAccount,
    /// The game's window closed (`true`), or the game came back (`false`). The room stays
    /// open meanwhile, for [`GAME_WAIT`] at most.
    GameClosed { closed: bool },
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
    let input_allowed = platform::input_allowed();
    if !input_allowed {
        platform::ask_input_permission();
    }
    let _ = events.send(Event::InputPermission {
        allowed: input_allowed,
    });

    let endpoint = net::open_endpoint(options.port, &options.stun)?;
    let sockets = net::Sockets::new(endpoint.sockets)?;
    if let Some(address) = sockets.main_address() {
        info!(%address, "listening for guests");
    }

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
    // Ends with the encoder, once capture stops.
    let watched = Arc::downgrade(&encoder);
    std::thread::Builder::new()
        .name("still window".into())
        .spawn(move || {
            while let Some(encoder) = watched.upgrade() {
                encoder.repeat_if_still();
                drop(encoder);
                std::thread::sleep(video::STILL_CHECK);
            }
        })?;
    let (sound_tx, sound) = mpsc::channel(SOUND_QUEUE);
    let (stopped_tx, mut capture_stopped) = mpsc::unbounded_channel();
    let thumbnails = Arc::new(thumbnail::Thumbnails::new(room.thumbnails.clone()));
    let start_capture = |window: &GameWindow| {
        Capture::start(
            window,
            size,
            options.fps,
            encoder.clone(),
            thumbnails.clone(),
            sound_tx.clone(),
            stopped_tx.clone(),
        )
    };
    let mut capture = Some(start_capture(window)?);
    info!(
        width = size.0,
        height = size.1,
        fps = options.fps,
        "capture started"
    );

    let (game_tx, game) = mpsc::unbounded_channel();
    let signal_out = room.outgoing.clone();
    let host = Host::new(
        sockets,
        endpoint.candidates,
        Game {
            pid: window.pid,
            focus_lock: !options.ignore_focus,
            input_allowed,
        },
        control,
        options.settings,
        Outputs {
            signal_out,
            thumbnails: thumbnails.clone(),
            events: events.clone(),
        },
    )
    .run(room, frames, sound, game, stop);
    tokio::pin!(host);

    let mut look = tokio::time::interval(GAME_LOOK);
    let mut closed_at: Option<Instant> = None;
    loop {
        tokio::select! {
            outcome = &mut host => return outcome,
            Some(reason) = capture_stopped.recv(), if capture.is_some() => {
                info!(%reason, "the game's window is gone; waiting for it to come back");
                capture = None;
                closed_at = Some(Instant::now());
                let _ = game_tx.send(GameChange::Closed);
                let _ = events.send(Event::GameClosed { closed: true });
            }
            _ = look.tick(), if capture.is_none() => {
                if closed_at.is_some_and(|at| at.elapsed() >= GAME_WAIT) {
                    return Err(anyhow!("the game closed and did not come back"));
                }
                let Some(back) = window_of(&window.app) else { continue };
                match start_capture(&back) {
                    Ok(started) => {
                        info!(title = %back.title, "sharing the game's new window");
                        capture = Some(started);
                        closed_at = None;
                        let _ = game_tx.send(GameChange::Back { pid: back.pid });
                        let _ = events.send(Event::GameClosed { closed: false });
                    }
                    Err(error) => warn!(%error, "the game's new window cannot be captured yet"),
                }
            }
        }
    }
}

/// The largest window of the program named `app`, once the game shows one again.
fn window_of(app: &str) -> Option<GameWindow> {
    list_windows()
        .ok()?
        .into_iter()
        .filter(|window| window.app == app)
        .max_by_key(|window| {
            let (width, height) = window.stream_size(u32::MAX);
            u64::from(width) * u64::from(height)
        })
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
