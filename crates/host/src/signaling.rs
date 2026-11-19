//! The host's WebSocket to the room server: opens the room, then relays negotiation.

use anyhow::{Context, Result, bail};
use couchwarp_protocol::signal::{EdgeToHost, HostToEdge};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, warn};

pub struct Room {
    pub code: String,
    /// Closes when the room server connection ends.
    pub incoming: mpsc::UnboundedReceiver<EdgeToHost>,
    pub outgoing: mpsc::UnboundedSender<HostToEdge>,
}

/// `server` is the site address guests open, e.g. `https://couchwarp.example`.
pub async fn open_room(server: &str) -> Result<Room> {
    let url = websocket_url(server)?;
    let (socket, _) = connect_async(&url)
        .await
        .with_context(|| format!("cannot reach the room server at {url}"))?;
    let (mut sink, mut source) = socket.split();

    let code = loop {
        let message = source
            .next()
            .await
            .context("the room server closed before opening a room")??;
        if let Message::Text(text) = message {
            match serde_json::from_str(&text) {
                Ok(EdgeToHost::RoomCreated { code }) => break code,
                Ok(other) => bail!("expected a new room, got {other:?}"),
                Err(error) => bail!("unreadable message from the room server: {error}"),
            }
        }
    };

    let (incoming_tx, incoming) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Some(message) = source.next().await {
            match message {
                Ok(Message::Text(text)) => match serde_json::from_str(&text) {
                    Ok(message) => {
                        if incoming_tx.send(message).is_err() {
                            break;
                        }
                    }
                    Err(error) => warn!(%error, "unreadable message from the room server"),
                },
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(error) => {
                    warn!(%error, "room server connection lost");
                    break;
                }
            }
        }
        debug!("room server stream ended");
    });

    let (outgoing, mut outgoing_rx) = mpsc::unbounded_channel::<HostToEdge>();
    tokio::spawn(async move {
        while let Some(message) = outgoing_rx.recv().await {
            let json = serde_json::to_string(&message).expect("signal messages always serialize");
            if let Err(error) = sink.send(Message::text(json)).await {
                warn!(%error, "message to the room server lost");
                break;
            }
        }
    });

    Ok(Room {
        code,
        incoming,
        outgoing,
    })
}

fn websocket_url(server: &str) -> Result<String> {
    let base = server.trim_end_matches('/');
    let url = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        bail!("the server address must start with http:// or https://, got {server}");
    };
    Ok(format!("{url}/api/host"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn site_addresses_become_websocket_urls() {
        assert_eq!(
            websocket_url("https://couchwarp.example/").unwrap(),
            "wss://couchwarp.example/api/host"
        );
        assert_eq!(
            websocket_url("http://localhost:5173").unwrap(),
            "ws://localhost:5173/api/host"
        );
        assert!(websocket_url("couchwarp.example").is_err());
    }
}
