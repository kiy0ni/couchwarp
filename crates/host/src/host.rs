//! The host's event loop: one thread that owns every guest connection, the input router
//! and the input sink. Frames, packets, room messages and timers come in; nothing is shared.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use couchwarp_protocol::control::{GuestControl, HostControl};
use couchwarp_protocol::signal::{EdgeToHost, GuestId, HostToEdge, SignalPayload};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Input};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tokio::time::{MissedTickBehavior, interval, sleep_until};
use tracing::{debug, info, warn};

use crate::audio::AudioPacket;
use crate::input::{Action, InputRouter};
use crate::peer::{Peer, PeerEvent};
use crate::platform::{InputSink, VIRTUAL_PADS, frontmost_pid};
use crate::signaling::Room;
use crate::stats::FrameDelays;
use crate::video::{EncodedFrame, StreamClock, unix_ms_now};

const FOCUS_CHECK: Duration = Duration::from_millis(100);
const IDLE_WAKE: Duration = Duration::from_millis(100);
const MAX_DATAGRAM: usize = 2000;

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
}

impl Host {
    pub fn new(
        socket: UdpSocket,
        local_candidates: Vec<Candidate>,
        game_pid: i32,
        focus_lock: bool,
        keyframe_wanted: Arc<AtomicBool>,
        signal_out: mpsc::UnboundedSender<HostToEdge>,
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
        }
    }

    /// Runs until Ctrl+C, or until the shared window goes away.
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

        loop {
            let deadline = self.drain();
            tokio::select! {
                Some(frame) = frames.recv() => self.send_frame(&frame),
                Some(packet) = sound.recv() => {
                    for peer in &mut self.peers {
                        peer.send_sound(&packet);
                    }
                }
                message = room.incoming.recv(), if room_open => match message {
                    Some(message) => self.on_room_message(message),
                    None => {
                        room_open = false;
                        warn!("lost the room server: guests already playing stay, new ones cannot join");
                    }
                },
                received = self.socket.recv_from(&mut buffer) => {
                    let (length, source) = received?;
                    self.on_datagram(&buffer[..length], source)?;
                }
                () = sleep_until(deadline.into()) => self.on_timeout(),
                _ = focus.tick() => self.check_focus(),
                Some(reason) = capture_stopped.recv() => {
                    bail!("the shared window is gone, so the game ended ({reason})");
                }
                _ = tokio::signal::ctrl_c() => break,
            }
        }
        info!("stopping");
        Ok(())
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
                let epoch_ms = self.clock.epoch_unix_ms();
                if let Some(peer) = self.peer(guest) {
                    info!(guest, name = %peer.name, "guest connected");
                    peer.send_control(&HostControl::HostInfo {
                        virtual_pads: VIRTUAL_PADS,
                    });
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
                let actions = self.router.remove_guest(guest_id);
                self.carry_out(actions);
            }
            EdgeToHost::Signal { from, payload } => self.on_signal(from, payload),
            EdgeToHost::RoomCreated { .. } => debug!("room already open"),
        }
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
