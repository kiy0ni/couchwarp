//! Couchwarp host: shares one game window with guests who join from a browser.

mod audio;
mod host;
mod input;
mod net;
mod peer;
mod platform;
mod signaling;
mod stats;
mod stun;
mod video;

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use anyhow::Result;
use clap::Parser;
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
    about = "Share a game window with friends who join from a browser"
)]
struct Args {
    /// Part of the window title or application name to share
    #[arg(short, long, required_unless_present = "list_windows")]
    window: Option<String>,

    /// List the windows that can be shared, then exit
    #[arg(long)]
    list_windows: bool,

    /// Address of the Couchwarp site, as guests open it
    #[arg(long, default_value = "http://localhost:5173")]
    server: String,

    /// Frames per second
    #[arg(long, default_value_t = 60)]
    fps: u32,

    /// Video bitrate, in megabits per second
    #[arg(long, default_value_t = 12)]
    bitrate: u32,

    /// Tallest picture sent, in pixels
    #[arg(long, default_value_t = 1080)]
    max_height: u32,

    /// UDP port for guests (0 picks a free one)
    #[arg(long, default_value_t = 0)]
    port: u16,

    /// Keep sending guests' keys while the game window is in the background. Keys still go
    /// to the game process only. Meant for testing host and guest on the same Mac.
    #[arg(long)]
    ignore_focus: bool,

    /// STUN server used to find this machine's public address
    #[arg(long, default_value = "stun.cloudflare.com:3478")]
    stun: String,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_target(false)
        .init();
    let args = Args::parse();
    platform::init();

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

    let room = signaling::open_room(&args.server).await?;
    print_invitation(&args.server, &room.code);

    let (frame_tx, frames) = mpsc::channel(FRAME_QUEUE);
    let keyframe_wanted = Arc::new(AtomicBool::new(true));
    let size = window.stream_size(args.max_height);
    let encoder = Arc::new(Encoder::new(
        &EncoderSettings {
            width: size.0,
            height: size.1,
            fps: args.fps,
            bitrate: args.bitrate * 1_000_000,
        },
        frame_tx,
        keyframe_wanted.clone(),
    )?);
    let (sound_tx, sound) = mpsc::channel(SOUND_QUEUE);
    let (stopped_tx, capture_stopped) = mpsc::unbounded_channel();
    let _capture = Capture::start(&window, size, args.fps, encoder, sound_tx, stopped_tx)?;
    info!(
        width = size.0,
        height = size.1,
        fps = args.fps,
        "capture started"
    );

    let signal_out = room.outgoing.clone();
    host::Host::new(
        socket,
        endpoint.candidates,
        window.pid,
        !args.ignore_focus,
        keyframe_wanted,
        signal_out,
    )
    .run(room, frames, sound, capture_stopped)
    .await
}

fn print_invitation(server: &str, code: &str) {
    let link = format!("{}/{code}", server.trim_end_matches('/'));
    println!("\n  Room code: {code}\n  Link:      {link}\n");
    if let Ok(qr) = QrCode::new(link.as_bytes()) {
        println!("{}", qr.render::<Dense1x2>().quiet_zone(true).build());
    }
}
