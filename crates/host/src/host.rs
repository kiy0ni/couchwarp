//! The host's event loop: one thread that owns every guest connection, the input router
//! and the input sink. Frames, packets, room messages and timers come in; nothing is shared.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use couchwarp_protocol::control::{GuestControl, HostControl};
use couchwarp_protocol::room::{
    GuestRole, Hotseat, HotseatMode, RoomSettings, RoomState, Visibility,
};
use couchwarp_protocol::signal::{EdgeToHost, GuestId, HostToEdge, SignalPayload};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Input};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tokio::time::{MissedTickBehavior, interval, sleep_until};
use tracing::{debug, info, warn};

use crate::audio::AudioPacket;
use crate::input::{Action, InputRouter, Permissions};
use crate::peer::{Peer, PeerEvent};
use crate::platform::{InputSink, frontmost_pid};
use crate::signaling::{Room, RoomEvent};
use crate::stats::FrameDelays;
use crate::video::{EncodedFrame, StreamClock, unix_ms_now};

const FOCUS_CHECK: Duration = Duration::from_millis(100);
const IDLE_WAKE: Duration = Duration::from_millis(100);
const MAX_DATAGRAM: usize = 2000;
/// How long the last messages to the room server may take once the host stops.
const FAREWELL: Duration = Duration::from_secs(2);

/// Room settings chosen on the command line, applied over the room server's defaults.
#[derive(Debug, Default, Clone)]
pub struct SettingsRequest {
    pub title: Option<String>,
    pub game: Option<String>,
    pub max_players: Option<u8>,
    pub public: bool,
    pub relay_only: bool,
    pub turn_minutes: Option<u32>,
}

impl SettingsRequest {
    fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.game.is_none()
            && self.max_players.is_none()
            && !self.public
            && !self.relay_only
            && self.turn_minutes.is_none()
    }

    fn apply_to(&self, current: &RoomSettings) -> RoomSettings {
        RoomSettings {
            title: self.title.clone().unwrap_or_else(|| current.title.clone()),
            game: self.game.clone().unwrap_or_else(|| current.game.clone()),
            max_players: self.max_players.unwrap_or(current.max_players),
            visibility: if self.public {
                Visibility::Public
            } else {
                current.visibility
            },
            relay_only: self.relay_only || current.relay_only,
            hotseat: match self.turn_minutes {
                Some(minutes) => Hotseat {
                    mode: HotseatMode::Timer,
                    minutes,
                },
                None => current.hotseat,
            },
        }
    }
}

/// What a member of the room may send to the game.
fn permissions(state: &RoomState, guest: GuestId) -> Permissions {
    match state.member(guest) {
        Some(member) if member.role != GuestRole::Spectator => Permissions {
            pads: true,
            keyboard: member.keyboard,
        },
        _ => Permissions::default(),
    }
}

pub struct Host {
    socket: UdpSocket,
    local_candidates: Vec<Candidate>,
    peers: Vec<Peer>,
    names: HashMap<GuestId, String>,
    router: InputRouter,
    sink: InputSink,
    game_pid: i32,
    /// Hold guest keys back while the game window is not in front.
    focus_lock: bool,
    clock: StreamClock,
    keyframe_wanted: Arc<AtomicBool>,
    signal_out: mpsc::UnboundedSender<HostToEdge>,
    delays: FrameDelays,
    /// The latest room state; `None` until the room server sends the first one.
    room_state: Option<RoomState>,
    /// Applied once, over the first room state.
    settings_request: Option<SettingsRequest>,
}

impl Host {
    pub fn new(
        socket: UdpSocket,
        local_candidates: Vec<Candidate>,
        game_pid: i32,
        focus_lock: bool,
        keyframe_wanted: Arc<AtomicBool>,
        signal_out: mpsc::UnboundedSender<HostToEdge>,
        settings_request: SettingsRequest,
    ) -> Self {
        Self {
            socket,
            local_candidates,
            peers: Vec::new(),
            names: HashMap::new(),
            router: InputRouter::new(!focus_lock || frontmost_pid() == Some(game_pid)),
            sink: InputSink::new(game_pid),
            game_pid,
            focus_lock,
            clock: StreamClock::start(),
            keyframe_wanted,
            signal_out,
            delays: FrameDelays::default(),
            room_state: None,
            settings_request: (!settings_request.is_empty()).then_some(settings_request),
        }
    }

    /// Runs until Ctrl+C, until the room is closed from the console, or until the shared
    /// window goes away. On Ctrl+C the room closes for everyone.
    pub async fn run(
        mut self,
        mut room: Room,
        mut frames: mpsc::Receiver<EncodedFrame>,
        mut sound: mpsc::Receiver<AudioPacket>,
        mut capture_stopped: mpsc::UnboundedReceiver<String>,
    ) -> Result<()> {
        let mut buffer = vec![0u8; MAX_DATAGRAM];
        let mut focus = interval(FOCUS_CHECK);
        focus.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut room_open = true;

        let outcome = loop {
            let deadline = self.drain();
            tokio::select! {
                Some(frame) = frames.recv() => self.send_frame(&frame),
                Some(packet) = sound.recv() => {
                    for peer in &mut self.peers {
                        peer.send_sound(&packet);
                    }
                }
                event = room.incoming.recv(), if room_open => match event {
                    Some(RoomEvent::Message(message)) => self.on_room_message(message),
                    Some(RoomEvent::Closed) => {
                        info!("the room was closed from the host console");
                        room_open = false;
                        break Ok(());
                    }
                    Some(RoomEvent::Lost) | None => {
                        room_open = false;
                        warn!("lost the room server: guests already playing stay, new ones cannot join");
                    }
                },
                received = self.socket.recv_from(&mut buffer) => {
                    let handled = received.map_err(anyhow::Error::from).and_then(|(length, source)| {
                        self.on_datagram(&buffer[..length], source)
                    });
                    if let Err(error) = handled {
                        break Err(error);
                    }
                }
                () = sleep_until(deadline.into()) => self.on_timeout(),
                _ = focus.tick() => self.check_focus(),
                Some(reason) = capture_stopped.recv() => {
                    break Err(anyhow!("the shared window is gone, so the game ended ({reason})"));
                }
                _ = tokio::signal::ctrl_c() => break Ok(()),
            }
        };
        info!("stopping");
        // Close the room for everyone, and give the message time to leave.
        if room_open {
            let _ = self.signal_out.send(HostToEdge::Close);
        }
        drop(self);
        drop(room.outgoing);
        if tokio::time::timeout(FAREWELL, room.writer).await.is_err() {
            warn!("the room server did not hear that the room closed");
        }
        outcome
    }

    /// Lets every peer send what it has queued and handles what they report, until all are
    /// quiet. Returns when the earliest peer needs the clock to move on.
    fn drain(&mut self) -> Instant {
        let mut deadline = Instant::now() + IDLE_WAKE;
        loop {
            let mut reported = Vec::new();
            for peer in &mut self.peers {
                let mut events = Vec::new();
                if let Some(at) = peer.poll(&self.socket, &mut events) {
                    deadline = deadline.min(at);
                }
                reported.extend(events.into_iter().map(|event| (peer.guest_id, event)));
            }
            self.remove_dead_peers();
            if reported.is_empty() {
                return deadline;
            }
            for (guest, event) in reported {
                self.on_peer_event(guest, event);
            }
        }
    }

    fn on_peer_event(&mut self, guest: GuestId, event: PeerEvent) {
        match event {
            PeerEvent::Connected => {
                let paused = self.router.keyboard_paused();
                let virtual_pads = self.sink.virtual_pads();
                let epoch_ms = self.clock.epoch_unix_ms();
                if let Some(peer) = self.peer(guest) {
                    info!(guest, name = %peer.name, "guest connected");
                    peer.send_control(&HostControl::HostInfo { virtual_pads });
                    peer.send_control(&HostControl::StreamClock { epoch_ms });
                    peer.send_control(&HostControl::InputPaused { paused });
                }
                self.keyframe_wanted.store(true, Ordering::Release);
            }
            PeerEvent::Input(packet) => {
                let actions = self.router.apply(guest, packet);
                self.carry_out(actions);
            }
            PeerEvent::Control(GuestControl::Ping { t0 }) => {
                let t1 = unix_ms_now();
                if let Some(peer) = self.peer(guest) {
                    peer.send_control(&HostControl::Pong { t0, t1 });
                }
            }
            PeerEvent::Control(GuestControl::PadRemoved { pad }) => {
                let actions = self.router.remove_pad(guest, pad);
                self.carry_out(actions);
            }
            PeerEvent::KeyframeWanted => self.keyframe_wanted.store(true, Ordering::Release),
        }
    }

    fn carry_out(&mut self, actions: Vec<Action>) {
        for action in actions {
            match action {
                Action::SlotAssigned { guest, pad, slot } => {
                    info!(guest, pad, slot, "controller takes a player slot");
                    if let Some(peer) = self.peer(guest) {
                        peer.send_control(&HostControl::Slot { pad, slot });
                    }
                }
                Action::SetPad { slot, state } => self.sink.set_pad(slot, &state),
                Action::ReleasePad { slot } => self.sink.release_pad(slot),
                Action::SetKeys(keys) => self.sink.set_keys(&keys),
                Action::KeyboardPaused(paused) => {
                    info!(paused, "guest keyboards follow the game window focus");
                    for peer in &mut self.peers {
                        peer.send_control(&HostControl::InputPaused { paused });
                    }
                }
            }
        }
    }

    fn on_room_message(&mut self, message: EdgeToHost) {
        match message {
            EdgeToHost::GuestJoined { guest_id, name } => {
                info!(guest = guest_id, %name, "guest joined the room");
                self.names.insert(guest_id, name);
            }
            EdgeToHost::GuestLeft { guest_id } => {
                info!(guest = guest_id, "guest left the room");
                self.names.remove(&guest_id);
                self.peers.retain(|peer| peer.guest_id != guest_id);
                let actions = self.router.forget_guest(guest_id);
                self.carry_out(actions);
            }
            EdgeToHost::Signal { from, payload } => self.on_signal(from, payload),
            EdgeToHost::RoomState { state } => self.on_room_state(state),
            EdgeToHost::Chat { message } => info!(from = %message.name, "chat: {}", message.text),
            EdgeToHost::RoomCreated { .. } => debug!("room already open"),
        }
    }

    /// Roles and permissions come from the room server; the router enforces them here.
    fn on_room_state(&mut self, state: RoomState) {
        if let Some(request) = self.settings_request.take() {
            let settings = request.apply_to(&state.settings);
            if self
                .signal_out
                .send(HostToEdge::Configure { settings })
                .is_err()
            {
                warn!("room settings not sent, the room server is gone");
            }
        }
        if let Some(refused) = state.public_refused
            && self.room_state.as_ref().and_then(|s| s.public_refused) != Some(refused)
        {
            warn!(
                ?refused,
                "the room stays unlisted: only people with the link can join"
            );
        }
        let guests: Vec<GuestId> = state
            .members
            .iter()
            .map(|member| member.id)
            .chain(self.names.keys().copied())
            .collect();
        for guest in guests {
            let actions = self
                .router
                .set_permissions(guest, permissions(&state, guest));
            self.carry_out(actions);
        }
        self.room_state = Some(state);
    }

    fn on_signal(&mut self, guest: GuestId, payload: SignalPayload) {
        match payload {
            SignalPayload::Offer { sdp } => {
                let name = self.names.get(&guest).cloned().unwrap_or_default();
                match Peer::answer(guest, name, &sdp, &self.local_candidates) {
                    Ok((peer, answer)) => {
                        self.peers.retain(|existing| existing.guest_id != guest);
                        self.peers.push(peer);
                        let reply = HostToEdge::Signal {
                            to: guest,
                            payload: SignalPayload::Answer { sdp: answer },
                        };
                        if self.signal_out.send(reply).is_err() {
                            warn!(guest, "answer not sent, the room server is gone");
                        }
                    }
                    Err(error) => warn!(guest, %error, "offer refused"),
                }
            }
            SignalPayload::Candidate { candidate, .. } => {
                if let Some(peer) = self.peer(guest) {
                    peer.add_remote_candidate(&candidate);
                }
            }
            SignalPayload::Answer { .. } => debug!(guest, "guests answer nothing, ignored"),
        }
    }

    fn on_datagram(&mut self, contents: &[u8], source: SocketAddr) -> Result<()> {
        let input = Input::Receive(
            Instant::now(),
            Receive::new(Protocol::Udp, source, self.socket.local_addr()?, contents)?,
        );
        match self.peers.iter_mut().find(|peer| peer.accepts(&input)) {
            Some(peer) => peer.handle_input(input),
            None => debug!(%source, "datagram for no guest"),
        }
        Ok(())
    }

    fn on_timeout(&mut self) {
        let now = Instant::now();
        for peer in &mut self.peers {
            peer.handle_input(Input::Timeout(now));
        }
    }

    fn send_frame(&mut self, frame: &EncodedFrame) {
        self.delays.record(frame.captured_at.elapsed());
        let rtp_ticks = self.clock.rtp_ticks(frame.captured_at);
        for peer in &mut self.peers {
            peer.send_frame(frame, rtp_ticks);
        }
    }

    fn check_focus(&mut self) {
        if !self.focus_lock {
            return;
        }
        let focused = frontmost_pid() == Some(self.game_pid);
        let actions = self.router.set_game_focused(focused);
        self.carry_out(actions);
    }

    fn remove_dead_peers(&mut self) {
        let dead: Vec<GuestId> = self
            .peers
            .iter()
            .filter(|peer| !peer.is_alive())
            .map(|peer| peer.guest_id)
            .collect();
        if dead.is_empty() {
            return;
        }
        self.peers.retain(Peer::is_alive);
        for guest in dead {
            info!(guest, "guest connection closed");
            let actions = self.router.remove_guest(guest);
            self.carry_out(actions);
        }
    }

    fn peer(&mut self, guest: GuestId) -> Option<&mut Peer> {
        self.peers.iter_mut().find(|peer| peer.guest_id == guest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use couchwarp_protocol::room::{Member, PadType};

    fn settings() -> RoomSettings {
        RoomSettings {
            title: "Partie de Kiyo".into(),
            game: String::new(),
            max_players: 4,
            visibility: Visibility::Link,
            relay_only: false,
            hotseat: Hotseat {
                mode: HotseatMode::Off,
                minutes: 5,
            },
        }
    }

    fn member(id: GuestId, role: GuestRole, keyboard: bool) -> Member {
        Member {
            id,
            name: format!("Guest {id}"),
            avatar_url: None,
            user_id: None,
            role,
            keyboard,
            mouse: false,
            pad_type: PadType::Xbox360,
        }
    }

    #[test]
    fn command_line_settings_override_only_what_they_name() {
        let request = SettingsRequest {
            game: Some("Overcooked".into()),
            public: true,
            turn_minutes: Some(3),
            ..SettingsRequest::default()
        };
        let applied = request.apply_to(&settings());
        assert_eq!(applied.title, "Partie de Kiyo");
        assert_eq!(applied.game, "Overcooked");
        assert_eq!(applied.visibility, Visibility::Public);
        assert_eq!(applied.hotseat.mode, HotseatMode::Timer);
        assert_eq!(applied.max_players, 4);
        assert!(SettingsRequest::default().is_empty());
    }

    #[test]
    fn spectators_and_strangers_may_send_nothing() {
        let state = RoomState {
            code: "K7M2QX".into(),
            settings: settings(),
            host_name: "Kiyo".into(),
            members: vec![
                member(1, GuestRole::Player, false),
                member(2, GuestRole::Moderator, true),
                member(3, GuestRole::Spectator, true),
            ],
            queue: vec![],
            turn_ends_at: None,
            public_refused: None,
            relay_available: false,
        };
        assert_eq!(
            permissions(&state, 1),
            Permissions {
                pads: true,
                keyboard: false
            }
        );
        assert_eq!(
            permissions(&state, 2),
            Permissions {
                pads: true,
                keyboard: true
            }
        );
        assert_eq!(permissions(&state, 3), Permissions::default());
        assert_eq!(permissions(&state, 9), Permissions::default());
    }
}
