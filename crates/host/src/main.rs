//! Couchwarp host: shares one game window with guests who join from a browser.

mod account;
mod audio;
#[cfg(any(target_os = "macos", test))]
mod avcc;
mod bitrate;
#[cfg(any(windows, test))]
mod ds4;
mod host;
mod input;
mod net;
#[cfg(any(windows, test))]
mod pc_keys;
mod peer;
mod platform;
mod signaling;
#[cfg(any(windows, test))]
mod software_h264;
mod stats;
mod stun;
mod thumbnail;
mod video;
#[cfg(any(windows, test))]
mod xinput;

use std::sync::Arc;

use anyhow::Result;
use clap::{Parser, Subcommand};
use qrcode::QrCode;
use qrcode::render::unicode::Dense1x2;
use tokio::sync::mpsc;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use platform::capture::{Capture, find_window, list_windows};
use platform::encoder::{Encoder, EncoderSettings};

/// Frames waiting for the network. Beyond this the encoder drops instead of queuing.
const FRAME_QUEUE: usize = 4;
/// Sound packets waiting for the network: 80 ms.
const SOUND_QUEUE: usize = 8;

#[derive(Parser)]
#[command(
    version,
    about = "Share a game window with friends who join from a browser",
    subcommand_negates_reqs = true
)]
struct Args {
    #[command(subcommand)]
    action: Option<Action>,

    /// Part of the window title or application name to share
    #[arg(short, long, required_unless_present = "list_windows")]
    window: Option<String>,

    /// List the windows that can be shared, then exit
    #[arg(long)]
    list_windows: bool,

    /// Address of the Couchwarp site, as guests open it
    #[arg(long, global = true, default_value = "http://localhost:5173")]
    server: String,

    /// Frames per second
    #[arg(long, default_value_t = 60)]
    fps: u32,

    /// Highest video bitrate, in megabits per second; it drops to fit the slowest guest
    #[arg(long, default_value_t = 12)]
    bitrate: u32,

    /// Tallest picture sent, in pixels
    #[arg(long, default_value_t = 1080)]
    max_height: u32,

    /// UDP port for guests (0 picks a free one)
    #[arg(long, default_value_t = 0)]
    port: u16,

    /// Keep sending guests' keys while the game window is in the background. macOS only,
    /// where keys go to the game process alone. Meant for testing host and guest on one Mac.
    #[arg(long)]
    ignore_focus: bool,

    /// STUN server used to find this machine's public address
    #[arg(long, default_value = "stun.cloudflare.com:3478")]
    stun: String,

    /// Name of the room, as guests see it
    #[arg(long)]
    title: Option<String>,

    /// Game being played, shown in the room list
    #[arg(long)]
    game: Option<String>,

    /// Seats for players; whoever joins after them watches
    #[arg(long, value_parser = clap::value_parser!(u8).range(1..=8))]
    players: Option<u8>,

    /// List the room publicly (needs a signed-in host)
    #[arg(long)]
    public: bool,

    /// Guests connect through the relay only, so nobody learns another's address
    #[arg(long)]
    relay_only: bool,

    /// Take turns: a spectator in line gets a seat every this many minutes
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=60))]
    turn_minutes: Option<u32>,
}

#[derive(Subcommand)]
enum Action {
    /// Sign in, so your games carry your name and can be listed publicly
    Login {
        #[arg(long, value_enum, default_value = "discord")]
        provider: account::Provider,
    },
    /// Sign out on this computer
    Logout,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_target(false)
        .init();
    let args = Args::parse();
    platform::init();
    if args.ignore_focus && !platform::KEYS_REACH_GAME_ONLY {
        anyhow::bail!(
            "--ignore-focus is unsafe on this system: keys would go to whatever window is in front"
        );
    }

    match args.action {
        Some(Action::Login { provider }) => {
            let name = account::sign_in(&args.server, provider)?;
            println!("Signed in as {name}.");
            return Ok(());
        }
        Some(Action::Logout) => {
            let signed_out = account::sign_out(&args.server)?;
            println!(
                "{}",
                if signed_out {
                    "Signed out."
                } else {
                    "Not signed in."
                }
            );
            return Ok(());
        }
        None => {}
    }

    if args.list_windows {
        for window in list_windows()? {
            println!("{:<28} {}", window.app, window.title);
        }
        return Ok(());
    }

    let window = find_window(args.window.as_deref().unwrap_or_default())?;
    info!(app = %window.app, title = %window.title, "sharing this window");
    if !platform::can_send_keys() {
        warn!(
            "keyboard input disabled: allow this terminal in System Settings > Privacy & \
             Security > Accessibility, then restart it"
        );
    }

    let endpoint = net::open_endpoint(args.port, &args.stun)?;
    endpoint.socket.set_nonblocking(true)?;
    let socket = tokio::net::UdpSocket::from_std(endpoint.socket)?;
    info!(address = %socket.local_addr()?, "listening for guests");

    let token = session_token(&args.server);
    if args.public && token.is_none() {
        warn!(
            "--public needs an account: run `couchwarp-host login` first; the game stays unlisted"
        );
    }
    let room = signaling::open_room(&args.server, token.as_deref()).await?;
    print_invitation(&args.server, &room.code, &room.console_key);

    let (frame_tx, frames) = mpsc::channel(FRAME_QUEUE);
    let control = video::EncoderControl::new(args.bitrate * 1_000_000);
    let size = window.stream_size(args.max_height);
    let encoder = Arc::new(Encoder::new(
        &EncoderSettings {
            width: size.0,
            height: size.1,
            fps: args.fps,
            bitrate: args.bitrate * 1_000_000,
        },
        frame_tx,
        control.clone(),
    )?);
    let (sound_tx, sound) = mpsc::channel(SOUND_QUEUE);
    let (stopped_tx, capture_stopped) = mpsc::unbounded_channel();
    let thumbnails = Arc::new(thumbnail::Thumbnails::new(room.thumbnails.clone()));
    let _capture = Capture::start(
        &window,
        size,
        args.fps,
        encoder,
        thumbnails.clone(),
        sound_tx,
        stopped_tx,
    )?;
    info!(
        width = size.0,
        height = size.1,
        fps = args.fps,
        "capture started"
    );

    let signal_out = room.outgoing.clone();
    let settings = host::SettingsRequest {
        title: args.title,
        game: args.game,
        max_players: args.players,
        public: args.public,
        relay_only: args.relay_only,
        turn_minutes: args.turn_minutes,
    };
    host::Host::new(
        socket,
        endpoint.candidates,
        host::Game {
            pid: window.pid,
            focus_lock: !args.ignore_focus,
        },
        control,
        signal_out,
        settings,
        thumbnails,
    )
    .run(room, frames, sound, capture_stopped)
    .await
}

/// The saved session for `server`, if the server still accepts it.
fn session_token(server: &str) -> Option<String> {
    let token = account::token(server)?;
    match account::display_name(server, &token) {
        Ok(Some(name)) => {
            info!(%name, "signed in");
            Some(token)
        }
        Ok(None) => {
            warn!("the saved session has expired: run `couchwarp-host login` to sign in again");
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

fn print_invitation(server: &str, code: &str, console_key: &str) {
    let site = server.trim_end_matches('/');
    let link = format!("{site}/{code}");
    // The key sits after `#`, so it never reaches a server log.
    let console = format!("{site}/{code}/console#key={console_key}");
    println!("\n  Room code: {code}\n  Link:      {link}\n  Console:   {console}\n");
    if let Ok(qr) = QrCode::new(link.as_bytes()) {
        println!("{}", qr.render::<Dense1x2>().quiet_zone(true).build());
    }
}
