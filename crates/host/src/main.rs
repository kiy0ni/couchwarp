//! Couchwarp host on the command line: shares one game window with guests who join from
//! a browser. The desktop app (`apps/desktop`) does the same with a window to click in.

use std::time::{Duration, Instant};

use anyhow::Result;
use clap::{Parser, Subcommand};
use couchwarp_host::platform::capture::{find_window, list_windows};
use couchwarp_host::session::{self, Event, Options};
use couchwarp_host::{SettingsRequest, account, platform};
use couchwarp_protocol::room::Admission;
use qrcode::QrCode;
use qrcode::render::unicode::Dense1x2;
use tokio::sync::mpsc;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

/// How often the stream's numbers are logged.
const STATS_EVERY: Duration = Duration::from_secs(10);

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

    /// Let everyone in without asking. Otherwise each guest waits until someone admits
    /// them from the room's page
    #[arg(long)]
    let_everyone_in: bool,

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

    match args.action {
        Some(Action::Login { provider }) => {
            let name = account::sign_in(&args.server, provider, |link| {
                println!("Opening the browser to sign in. If it does not open, visit:\n  {link}\n");
            })?;
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
    let token = session::saved_token(&args.server);
    let options = Options {
        server: args.server.clone(),
        fps: args.fps,
        bitrate_mbps: args.bitrate,
        max_height: args.max_height,
        port: args.port,
        stun: args.stun,
        ignore_focus: args.ignore_focus,
        settings: SettingsRequest {
            title: args.title,
            game: args.game,
            max_players: args.players,
            public: args.public,
            relay_only: args.relay_only,
            admission: args.let_everyone_in.then_some(Admission::Open),
            turn_minutes: args.turn_minutes,
        },
    };
    let (events_tx, mut events) = mpsc::unbounded_channel();
    let server = args.server;
    let printer = tokio::spawn(async move {
        let mut last_stats: Option<Instant> = None;
        while let Some(event) = events.recv().await {
            match event {
                Event::Opened { code, console_key } => {
                    print_invitation(&server, &code, &console_key);
                }
                Event::Stats(stats) => {
                    if last_stats.is_none_or(|at| at.elapsed() >= STATS_EVERY) {
                        last_stats = Some(Instant::now());
                        info!(
                            fps = format!("{:.0}", stats.fps),
                            median_ms = format!("{:.1}", stats.median_ms),
                            p95_ms = format!("{:.1}", stats.p95_ms),
                            guests = stats.guests,
                            "capture to network"
                        );
                    }
                }
                Event::InputPermission { allowed: false } => warn!(
                    "keyboard input disabled: allow this terminal in System Settings > \
                     Privacy & Security > Accessibility"
                ),
                Event::InputPermission { allowed: true } => info!("guests' keys reach the game"),
                // The host loop already logs these.
                Event::InputPaused { .. } | Event::GameClosed { .. } => {}
                Event::PublicNeedsAccount => warn!(
                    "--public needs an account: run `couchwarp-host login` first; the game \
                     stays unlisted"
                ),
            }
        }
    });
    let stop = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    let outcome = session::run(&window, options, token, events_tx, stop).await;
    let _ = printer.await;
    outcome
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
