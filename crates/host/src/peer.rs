//! One guest's WebRTC connection, driven by str0m: video out, input and control in.
//!
//! str0m does no I/O of its own. After every change to a [`Peer`] (a packet, a frame, a
//! control message), the host calls [`Peer::poll`] until str0m has nothing left to send.

use std::time::Instant;

use anyhow::{Context, Result};
use couchwarp_protocol::control::{GuestControl, HostControl};
use couchwarp_protocol::input::InputPacket;
use couchwarp_protocol::signal::GuestId;
use str0m::change::SdpOffer;
use str0m::channel::{ChannelData, ChannelId};
use str0m::format::Codec;
use str0m::media::{Frequency, MediaKind, MediaTime, Mid, Pt};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};
use tokio::net::UdpSocket;
use tracing::{debug, trace, warn};

use crate::audio::AudioPacket;
use crate::video::EncodedFrame;

/// Constrained baseline H.264, the profile the encoder produces.
const CONSTRAINED_BASELINE: u32 = 0x42e0;

#[derive(Debug)]
pub enum PeerEvent {
    /// The control channel is open: the guest can hear the host.
    Connected,
    Input(InputPacket),
    Control(GuestControl),
    /// The guest's decoder lost track; only a keyframe repairs the picture.
    KeyframeWanted,
}

pub struct Peer {
    pub guest_id: GuestId,
    pub name: String,
    rtc: Rtc,
    video: Option<(Mid, Pt)>,
    audio: Option<(Mid, Pt)>,
    control: Option<ChannelId>,
    input: Option<ChannelId>,
}

impl Peer {
    /// Accepts a guest's offer. Returns the peer and the SDP answer to send back.
    pub fn answer(
        guest_id: GuestId,
        name: String,
        offer: &str,
        local_candidates: &[Candidate],
    ) -> Result<(Self, String)> {
        let mut rtc = Rtc::builder()
            .clear_codecs()
            .enable_h264(true)
            .enable_opus(true, false)
            .build(Instant::now());
        for candidate in local_candidates {
            rtc.add_local_candidate(candidate.clone());
        }
        let offer = SdpOffer::from_sdp_string(offer).context("unreadable SDP offer")?;
        let answer = rtc
            .sdp_api()
            .accept_offer(offer)
            .context("offer not acceptable")?;
        let peer = Self {
            guest_id,
            name,
            rtc,
            video: None,
            audio: None,
            control: None,
            input: None,
        };
        Ok((peer, answer.to_sdp_string()))
    }

    pub fn add_remote_candidate(&mut self, line: &str) {
        match Candidate::from_sdp_string(line) {
            Ok(candidate) => self.rtc.add_remote_candidate(candidate),
            // Browsers hide LAN addresses behind mDNS names (`xxxx.local`) that str0m cannot
            // resolve. The connection still forms from the guest's other candidates.
            Err(error) => debug!(guest = self.guest_id, %error, "candidate skipped"),
        }
    }

    pub fn is_alive(&self) -> bool {
        self.rtc.is_alive()
    }

    pub fn accepts(&self, input: &Input) -> bool {
        self.rtc.accepts(input)
    }

    pub fn handle_input(&mut self, input: Input) {
        if let Err(error) = self.rtc.handle_input(input) {
            warn!(guest = self.guest_id, %error, "connection dropped");
            self.rtc.disconnect();
        }
    }

    /// Sends what str0m has queued and collects what happened. Returns when str0m next
    /// needs the time to move on.
    pub fn poll(&mut self, socket: &UdpSocket, events: &mut Vec<PeerEvent>) -> Option<Instant> {
        while self.rtc.is_alive() {
            match self.rtc.poll_output() {
                Ok(Output::Timeout(at)) => return Some(at),
                Ok(Output::Transmit(packet)) => {
                    // UDP: a send that would block is a lost packet, which WebRTC recovers from.
                    if let Err(error) = socket.try_send_to(&packet.contents, packet.destination) {
                        trace!(%error, "packet not sent");
                    }
                }
                Ok(Output::Event(event)) => self.on_event(event, events),
                Err(error) => {
                    warn!(guest = self.guest_id, %error, "connection failed");
                    self.rtc.disconnect();
                }
            }
        }
        None
    }

    pub fn send_frame(&mut self, frame: &EncodedFrame, rtp_ticks: u64) {
        let Some((mid, pt)) = self.video else { return };
        let Some(writer) = self.rtc.writer(mid) else {
            return;
        };
        let rtp_time = MediaTime::new(rtp_ticks, Frequency::NINETY_KHZ);
        if let Err(error) = writer.write(pt, frame.captured_at, rtp_time, frame.annex_b.clone()) {
            warn!(guest = self.guest_id, %error, "frame not sent");
        }
    }

    pub fn send_sound(&mut self, packet: &AudioPacket) {
        let Some((mid, pt)) = self.audio else { return };
        let Some(writer) = self.rtc.writer(mid) else {
            return;
        };
        let rtp_time = MediaTime::new(packet.rtp_ticks, Frequency::FORTY_EIGHT_KHZ);
        if let Err(error) = writer.write(pt, Instant::now(), rtp_time, packet.opus.clone()) {
            warn!(guest = self.guest_id, %error, "sound not sent");
        }
    }

    pub fn send_control(&mut self, message: &HostControl) {
        let Some(mut channel) = self.control.and_then(|id| self.rtc.channel(id)) else {
            return;
        };
        let json = serde_json::to_string(message).expect("control messages always serialize");
        if let Err(error) = channel.write(false, json.as_bytes()) {
            warn!(guest = self.guest_id, %error, "control message not sent");
        }
    }

    fn on_event(&mut self, event: Event, events: &mut Vec<PeerEvent>) {
        match event {
            Event::MediaAdded(media) if media.kind == MediaKind::Video => {
                self.video = self.pick_video_payload(media.mid).map(|pt| (media.mid, pt));
                if self.video.is_none() {
                    warn!(
                        guest = self.guest_id,
                        "the guest offered no constrained baseline H.264"
                    );
                }
            }
            Event::MediaAdded(media) if media.kind == MediaKind::Audio => {
                self.audio = self.pick_opus_payload(media.mid).map(|pt| (media.mid, pt));
            }
            Event::ChannelOpen(id, label) => match label.as_str() {
                "control" => {
                    self.control = Some(id);
                    events.push(PeerEvent::Connected);
                }
                "input" => self.input = Some(id),
                other => debug!(guest = self.guest_id, label = other, "unknown channel"),
            },
            Event::ChannelData(data) => self.on_channel_data(data, events),
            Event::KeyframeRequest(_) => events.push(PeerEvent::KeyframeWanted),
            Event::IceConnectionStateChange(IceConnectionState::Disconnected) => {
                self.rtc.disconnect();
            }
            _ => {}
        }
    }

    fn on_channel_data(&self, data: ChannelData, events: &mut Vec<PeerEvent>) {
        if Some(data.id) == self.input {
            match InputPacket::decode(&data.data) {
                Ok(packet) => events.push(PeerEvent::Input(packet)),
                Err(error) => debug!(guest = self.guest_id, %error, "input packet dropped"),
            }
        } else if Some(data.id) == self.control {
            match serde_json::from_slice(&data.data) {
                Ok(message) => events.push(PeerEvent::Control(message)),
                Err(error) => debug!(guest = self.guest_id, %error, "control message dropped"),
            }
        }
    }

    fn pick_opus_payload(&mut self, mid: Mid) -> Option<Pt> {
        let writer = self.rtc.writer(mid)?;
        writer
            .payload_params()
            .find(|params| params.spec().codec == Codec::Opus)
            .map(|params| params.pt())
    }

    fn pick_video_payload(&mut self, mid: Mid) -> Option<Pt> {
        let writer = self.rtc.writer(mid)?;
        let h264: Vec<_> = writer
            .payload_params()
            .filter(|params| {
                let spec = params.spec();
                spec.codec == Codec::H264 && spec.format.packetization_mode == Some(1)
            })
            .collect();
        let baseline = h264.iter().find(|params| {
            params
                .spec()
                .format
                .profile_level_id
                .is_some_and(|id| id >> 8 == CONSTRAINED_BASELINE)
        });
        baseline.or(h264.first()).map(|params| params.pt())
    }
}
