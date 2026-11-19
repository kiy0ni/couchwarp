//! The shared state of a room and the commands that change it.
//! Field meanings and limits: `packages/protocol/src/room.ts`.

use serde::{Deserialize, Serialize};

use crate::signal::GuestId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GuestRole {
    Moderator,
    Player,
    Spectator,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Visibility {
    Link,
    Public,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PadType {
    #[default]
    #[serde(rename = "xbox360")]
    Xbox360,
    #[serde(rename = "dualshock4")]
    DualShock4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HotseatMode {
    Off,
    Manual,
    Timer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hotseat {
    pub mode: HotseatMode,
    pub minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSettings {
    pub title: String,
    pub game: String,
    pub max_players: u8,
    pub visibility: Visibility,
    pub relay_only: bool,
    pub hotseat: Hotseat,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: GuestId,
    pub name: String,
    pub avatar_url: Option<String>,
    pub user_id: Option<String>,
    pub role: GuestRole,
    pub keyboard: bool,
    pub mouse: bool,
    pub pad_type: PadType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PublicRefused {
    SignInRequired,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomState {
    pub code: String,
    pub settings: RoomSettings,
    pub host_name: String,
    pub members: Vec<Member>,
    pub queue: Vec<GuestId>,
    pub turn_ends_at: Option<u64>,
    pub public_refused: Option<PublicRefused>,
    pub relay_available: bool,
}

impl RoomState {
    pub fn member(&self, guest: GuestId) -> Option<&Member> {
        self.members.iter().find(|member| member.id == guest)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    /// None for the host.
    pub from: Option<GuestId>,
    pub name: String,
    pub text: String,
    /// Unix time in milliseconds.
    pub at: u64,
}
