//! Checks the Rust protocol against the shared examples in `fixtures/protocol`.

use std::path::PathBuf;

use couchwarp_protocol::control::{GuestControl, HostControl};
use couchwarp_protocol::input::{
    Buttons, GamepadState, InputPacket, KeyboardState, MouseButtons, MouseState,
};
use couchwarp_protocol::signal::{EdgeToHost, HostToEdge};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/protocol")
        .join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    serde_json::from_str(&text).unwrap()
}

fn list(fixture: &Value, key: &str) -> Vec<Value> {
    fixture[key].as_array().unwrap().clone()
}

fn from_hex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GamepadExample {
    pad: u8,
    seq: u16,
    buttons: u16,
    left_stick: [i16; 2],
    right_stick: [i16; 2],
    left_trigger: u8,
    right_trigger: u8,
}

#[derive(Deserialize)]
struct KeyboardExample {
    seq: u16,
    keys: Vec<u8>,
}

fn check_input(example: &Value, expected: InputPacket) {
    let name = example["name"].as_str().unwrap();
    let bytes = from_hex(example["hex"].as_str().unwrap());
    assert_eq!(expected.encode(), bytes, "encode: {name}");
    assert_eq!(InputPacket::decode(&bytes), Ok(expected), "decode: {name}");
}

#[test]
fn gamepad_packets_match_the_fixtures() {
    for example in list(&fixture("input.json"), "gamepad") {
        let p: GamepadExample = serde_json::from_value(example["packet"].clone()).unwrap();
        let expected = InputPacket::Gamepad(GamepadState {
            pad: p.pad,
            seq: p.seq,
            buttons: Buttons(p.buttons),
            left_stick: p.left_stick,
            right_stick: p.right_stick,
            left_trigger: p.left_trigger,
            right_trigger: p.right_trigger,
        });
        check_input(&example, expected);
    }
}

#[test]
fn keyboard_packets_match_the_fixtures() {
    for example in list(&fixture("input.json"), "keyboard") {
        let k: KeyboardExample = serde_json::from_value(example["packet"].clone()).unwrap();
        check_input(
            &example,
            InputPacket::Keyboard(KeyboardState {
                seq: k.seq,
                keys: k.keys,
            }),
        );
    }
}

#[derive(Deserialize)]
struct MouseExample {
    seq: u16,
    buttons: u8,
    dx: i16,
    dy: i16,
    wheel: i16,
}

#[test]
fn mouse_packets_match_the_fixtures() {
    for example in list(&fixture("input.json"), "mouse") {
        let m: MouseExample = serde_json::from_value(example["packet"].clone()).unwrap();
        check_input(
            &example,
            InputPacket::Mouse(MouseState {
                seq: m.seq,
                buttons: MouseButtons(m.buttons),
                dx: m.dx,
                dy: m.dy,
                wheel: m.wheel,
            }),
        );
    }
}

#[test]
fn invalid_packets_are_rejected() {
    for example in list(&fixture("input.json"), "invalid") {
        let bytes = from_hex(example["hex"].as_str().unwrap());
        assert!(
            InputPacket::decode(&bytes).is_err(),
            "accepted: {}",
            example["name"]
        );
    }
}

/// Parses every example, writes it back and parses the result again:
/// the message must survive the round trip unchanged.
fn round_trip<T>(examples: Vec<Value>)
where
    T: DeserializeOwned + serde::Serialize + PartialEq + std::fmt::Debug,
{
    for example in examples {
        let parsed: T =
            serde_json::from_value(example.clone()).unwrap_or_else(|e| panic!("{example}: {e}"));
        let written = serde_json::to_value(&parsed).unwrap();
        assert_eq!(written["type"], example["type"]);
        assert_eq!(serde_json::from_value::<T>(written).unwrap(), parsed);
    }
}

#[test]
fn signal_messages_match_the_fixtures() {
    let signal = fixture("signal.json");
    round_trip::<EdgeToHost>(list(&signal, "edgeToHost"));
    round_trip::<HostToEdge>(list(&signal, "hostToEdge"));
}

#[test]
fn control_messages_match_the_fixtures() {
    let control = fixture("control.json");
    round_trip::<GuestControl>(list(&control, "guestToHost"));
    round_trip::<HostControl>(list(&control, "hostToGuest"));
}

#[test]
fn signal_fields_are_camel_case() {
    let message = serde_json::to_value(EdgeToHost::GuestLeft { guest_id: 3 }).unwrap();
    assert_eq!(
        message,
        serde_json::json!({ "type": "guest-left", "guestId": 3 })
    );
}
