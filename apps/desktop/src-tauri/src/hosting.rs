//! The hosting session behind the Host page: at most one at a time, on its own thread
//! with its own async runtime, like the command line. The page follows it through the
//! `hosting` event and `hosting_state`.

use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use couchwarp_host::SettingsRequest;
use couchwarp_host::platform::capture::{GameWindow, list_windows};
use couchwarp_host::session::{self, Event, Options};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use tracing::warn;

use crate::awake::KeepAwake;
use crate::bubble;

/// How long closing the app waits for the room to hear that it closed.
const FAREWELL: Duration = Duration::from_secs(3);

/// A window that can be shared, as the page lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    /// A string: window handles can exceed what a JavaScript number holds exactly.
    pub id: String,
    pub app: String,
    pub title: String,
}

impl From<&GameWindow> for WindowInfo {
    fn from(window: &GameWindow) -> Self {
        Self {
            id: window.id.to_string(),
            app: window.app.clone(),
            title: window.title.clone(),
        }
    }
}

/// The windows of other apps, largest first: the game is rarely a small one.
pub fn shareable_windows() -> anyhow::Result<Vec<GameWindow>> {
    let own = std::process::id() as i32;
    let mut windows: Vec<GameWindow> = list_windows()?
        .into_iter()
        .filter(|window| window.pid != own)
        .collect();
    windows.sort_by_key(|window| {
        let (width, height) = window.stream_size(u32::MAX);
        std::cmp::Reverse(u64::from(width) * u64::from(height))
    });
    Ok(windows)
}

fn find_window(id: &str) -> anyhow::Result<Option<GameWindow>> {
    Ok(shareable_windows()?
        .into_iter()
        .find(|window| window.id.to_string() == id))
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsView {
    pub fps: f64,
    pub median_ms: f64,
    pub bitrate_mbps: f64,
    pub guests: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HostingState {
    /// Not hosting. `error` says why the last session ended, if it failed.
    Idle {
        error: Option<String>,
    },
    Starting {
        window: WindowInfo,
    },
    Live {
        window: WindowInfo,
        code: String,
        console_key: String,
        stats: Option<StatsView>,
        no_input_permission: bool,
        /// The game is behind another window: guests' keyboards and mice wait.
        input_paused: bool,
        public_needs_account: bool,
    },
}

/// What the page asks for when it starts hosting.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub window_id: String,
    pub title: Option<String>,
    pub game: Option<String>,
    pub max_players: Option<u8>,
    pub public: bool,
    pub turn_minutes: Option<u32>,
    pub fps: u32,
    pub bitrate_mbps: u32,
    pub max_height: u32,
    pub keep_awake: bool,
    /// Guests' keys wait while the game window is not in front.
    pub focus_lock: bool,
    /// The small window over the game, while it runs.
    pub bubble: bool,
    /// UDP port for guests, 0 for any free one.
    pub port: u16,
    pub stun: String,
}

impl StartRequest {
    fn options(&self, server: &str) -> Options {
        let text = |value: Option<String>| {
            value
                .map(|text| text.trim().to_owned())
                .filter(|text| !text.is_empty())
        };
        Options {
            fps: self.fps.clamp(30, 120),
            bitrate_mbps: self.bitrate_mbps.clamp(2, 50),
            max_height: self.max_height.clamp(480, 2160),
            port: self.port,
            stun: text(Some(self.stun.clone())).unwrap_or_else(|| Options::new(server).stun),
            // Only a Mac sends keys to the game alone, so only there may the lock be off.
            ignore_focus: !self.focus_lock && couchwarp_host::platform::KEYS_REACH_GAME_ONLY,
            settings: SettingsRequest {
                title: text(self.title.clone()),
                game: text(self.game.clone()),
                max_players: self.max_players.map(|players| players.clamp(1, 8)),
                public: self.public,
                // Hiding guests' addresses is the room's default; the console changes it.
                relay_only: false,
                // Who comes in is chosen in the console, like the relay.
                admission: None,
                turn_minutes: self.turn_minutes.map(|minutes| minutes.clamp(1, 60)),
            },
            ..Options::new(server)
        }
    }
}

struct Session {
    stop: Option<oneshot::Sender<()>>,
    thread: JoinHandle<()>,
}

#[derive(Default)]
pub struct Hosting {
    state: Arc<Mutex<Option<HostingState>>>,
    session: Mutex<Option<Session>>,
}

impl Hosting {
    pub fn state(&self) -> HostingState {
        self.state
            .lock()
            .expect("never poisoned")
            .clone()
            .unwrap_or(HostingState::Idle { error: None })
    }

    /// Starts sharing the window `request.window_id` with guests of `server`.
    pub fn start(
        &self,
        app: AppHandle,
        server: String,
        request: StartRequest,
    ) -> Result<(), String> {
        let mut session = self.session.lock().expect("never poisoned");
        if session.as_ref().is_some_and(|s| !s.thread.is_finished()) {
            return Err("already-hosting".to_owned());
        }
        let info = find_window(&request.window_id)
            .map_err(|error| error.to_string())?
            .as_ref()
            .map(WindowInfo::from)
            .ok_or("window-gone")?;
        let publish = Publisher {
            app,
            state: self.state.clone(),
            bubble: request.bubble,
        };
        publish.set(HostingState::Starting {
            window: info.clone(),
        });

        let (stop_tx, stop) = oneshot::channel();
        let options = request.options(&server);
        let keep_awake = request.keep_awake;
        let thread = std::thread::Builder::new()
            .name("host".to_owned())
            .spawn(move || {
                // Found again on this thread: a window handle stays on the thread using it.
                let _awake = keep_awake.then(KeepAwake::start);
                // The host looks for virtual controllers once, as the game starts.
                crate::controllers::ensure_running();
                let outcome = match find_window(&info.id) {
                    Ok(Some(window)) => run(&window, info, options, &server, stop, &publish),
                    Ok(None) => Err(anyhow::anyhow!("the window closed before the game started")),
                    Err(error) => Err(error),
                };
                publish.set(HostingState::Idle {
                    error: outcome.err().map(|error| format!("{error:#}")),
                });
            })
            .map_err(|error| error.to_string())?;
        *session = Some(Session {
            stop: Some(stop_tx),
            thread,
        });
        Ok(())
    }

    /// Closes the room for everyone. The state turns idle once the room server heard it.
    pub fn stop(&self) {
        if let Some(stop) = self
            .session
            .lock()
            .expect("never poisoned")
            .as_mut()
            .and_then(|session| session.stop.take())
        {
            let _ = stop.send(());
        }
    }

    /// Stops and waits a little for the room to close, as the app quits.
    pub fn stop_and_wait(&self) {
        self.stop();
        let Some(session) = self.session.lock().expect("never poisoned").take() else {
            return;
        };
        let deadline = Instant::now() + FAREWELL;
        while !session.thread.is_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

/// Keeps the state and tells the page each time it changes.
struct Publisher {
    app: AppHandle,
    state: Arc<Mutex<Option<HostingState>>>,
    /// Shows the bubble while the game is live.
    bubble: bool,
}

impl Publisher {
    fn set(&self, state: HostingState) {
        match state {
            HostingState::Live { .. } if self.bubble => {
                if let Err(error) = bubble::open(&self.app) {
                    warn!(%error, "the bubble did not open");
                }
            }
            HostingState::Idle { .. } => bubble::close(&self.app),
            _ => {}
        }
        *self.state.lock().expect("never poisoned") = Some(state.clone());
        if let Err(error) = self.app.emit("hosting", state) {
            warn!(%error, "hosting state not sent to the page");
        }
    }

    fn update(&self, change: impl FnOnce(&mut HostingState)) {
        let mut state = self.state.lock().expect("never poisoned");
        let Some(current) = state.as_mut() else {
            return;
        };
        change(current);
        let snapshot = current.clone();
        drop(state);
        if let Err(error) = self.app.emit("hosting", snapshot) {
            warn!(%error, "hosting state not sent to the page");
        }
    }
}

fn run(
    window: &GameWindow,
    info: WindowInfo,
    options: Options,
    server: &str,
    stop: oneshot::Receiver<()>,
    publish: &Publisher,
) -> anyhow::Result<()> {
    let token = session::saved_token(server);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let session = session::run(window, options, token, events_tx, async {
            let _ = stop.await;
        });
        let follow = async {
            let mut no_input_permission = false;
            let mut public_needs_account = false;
            while let Some(event) = events.recv().await {
                match event {
                    Event::Opened { code, console_key } => publish.set(HostingState::Live {
                        window: info.clone(),
                        code,
                        console_key,
                        stats: None,
                        no_input_permission,
                        input_paused: false,
                        public_needs_account,
                    }),
                    Event::Stats(stats) => publish.update(|state| {
                        if let HostingState::Live { stats: shown, .. } = state {
                            *shown = Some(StatsView {
                                fps: stats.fps,
                                median_ms: stats.median_ms,
                                bitrate_mbps: f64::from(stats.bitrate) / 1e6,
                                guests: stats.guests,
                            });
                        }
                    }),
                    Event::InputPermission { allowed } => {
                        no_input_permission = !allowed;
                        publish.update(|state| {
                            if let HostingState::Live {
                                no_input_permission: shown,
                                ..
                            } = state
                            {
                                *shown = !allowed;
                            }
                        });
                    }
                    Event::InputPaused { paused } => publish.update(|state| {
                        if let HostingState::Live {
                            input_paused: shown,
                            ..
                        } = state
                        {
                            *shown = paused;
                        }
                    }),
                    Event::PublicNeedsAccount => public_needs_account = true,
                }
            }
        };
        // The session ends first; its events channel then closes and `follow` drains it.
        let (outcome, ()) = tokio::join!(session, follow);
        outcome
    })
}
