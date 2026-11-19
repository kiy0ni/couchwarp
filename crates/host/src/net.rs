//! The one UDP socket every guest connection shares, and the addresses guests can try
//! to reach it at.

use std::net::{IpAddr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::Duration;

use anyhow::{Context, Result};
use str0m::Candidate;
use tracing::{info, warn};

use crate::stun;

const STUN_TIMEOUT: Duration = Duration::from_millis(800);
const STUN_ATTEMPTS: usize = 3;

pub struct Endpoint {
    pub socket: UdpSocket,
    /// The LAN address, then the public one when the router translates it.
    pub candidates: Vec<Candidate>,
}

/// Binds on the interface that holds the default route, so the address handed to guests
/// is one they can reach. Other interfaces (VPNs, virtual adapters) are left out.
pub fn open_endpoint(port: u16, stun_server: &str) -> Result<Endpoint> {
    let ip = default_route_ip().context("no network connection")?;
    let socket = UdpSocket::bind(SocketAddr::new(ip, port))
        .with_context(|| format!("cannot open UDP port {port} on {ip}"))?;
    let local = socket.local_addr()?;
    let mut candidates = vec![Candidate::host(local, "udp")?];

    match public_address(&socket, stun_server) {
        Some(public) if public != local => {
            info!(%public, "public address found");
            candidates.push(Candidate::server_reflexive(public, local, "udp")?);
        }
        Some(_) => info!("this machine has a public address"),
        None => warn!("no answer from {stun_server}: only guests on this network can connect"),
    }
    Ok(Endpoint { socket, candidates })
}

/// The address the system would send from to reach the Internet. Connecting a UDP
/// socket sends nothing; it only asks the routing table.
fn default_route_ip() -> Result<IpAddr> {
    let probe = UdpSocket::bind("0.0.0.0:0")?;
    probe.connect("1.1.1.1:53")?;
    Ok(probe.local_addr()?.ip())
}

fn public_address(socket: &UdpSocket, stun_server: &str) -> Option<SocketAddr> {
    let server = stun_server
        .to_socket_addrs()
        .ok()?
        .find(SocketAddr::is_ipv4)?;
    socket.set_read_timeout(Some(STUN_TIMEOUT)).ok()?;
    let mut buffer = [0u8; 512];
    for _ in 0..STUN_ATTEMPTS {
        let transaction: stun::TransactionId = std::array::from_fn(|_| fastrand::u8(..));
        socket
            .send_to(&stun::binding_request(transaction), server)
            .ok()?;
        while let Ok((length, from)) = socket.recv_from(&mut buffer) {
            if from == server
                && let Some(address) = stun::mapped_address(&buffer[..length], transaction)
            {
                return Some(address);
            }
        }
    }
    None
}
