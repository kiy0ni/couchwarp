//! JSON messages between the host and the room server, over a WebSocket.
//!
//! The room server only relays WebRTC negotiation; video and input never pass through it.

use serde::{Deserialize, Serialize};

/// Assigned by the room server, unique within a room.
pub type GuestId = u32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum EdgeToHost {
    RoomCreated {
        code: String,
    },
    GuestJoined {
        guest_id: GuestId,
        name: String,
    },
    GuestLeft {
        guest_id: GuestId,
    },
    Signal {
        from: GuestId,
        payload: SignalPayload,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum HostToEdge {
    Signal { to: GuestId, payload: SignalPayload },
}

/// WebRTC negotiation. The guest always makes the offer; the host answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SignalPayload {
    Offer {
        sdp: String,
    },
    Answer {
        sdp: String,
    },
    Candidate {
        candidate: String,
        sdp_mid: Option<String>,
    },
}
