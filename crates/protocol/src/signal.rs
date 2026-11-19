//! JSON messages between the host and the room server, over a WebSocket.
//!
//! The room server only relays WebRTC negotiation; video and input never pass through it.

use serde::{Deserialize, Serialize};

use crate::room::{ChatMessage, GuestRole, PadType, RoomSettings, RoomState};

/// Assigned by the room server, unique within a room.
pub type GuestId = u32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum EdgeToHost {
    /// `console_key` opens the host console, a page to manage the room from any device.
    RoomCreated {
        code: String,
        console_key: String,
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
    RoomState {
        state: RoomState,
    },
    Chat {
        message: ChatMessage,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum HostToEdge {
    Signal {
        to: GuestId,
        payload: SignalPayload,
    },
    Configure {
        settings: RoomSettings,
    },
    SetRole {
        guest_id: GuestId,
        role: GuestRole,
    },
    SetPermissions {
        guest_id: GuestId,
        keyboard: bool,
        mouse: bool,
    },
    SetPadType {
        guest_id: GuestId,
        pad_type: PadType,
    },
    Kick {
        guest_id: GuestId,
        ban: bool,
    },
    NextTurn,
    Chat {
        text: String,
    },
    Close,
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
