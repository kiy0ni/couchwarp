//! The UDP sockets every guest connection shares, and the addresses guests can try to
//! reach them at: the main one on the interface with the default route (with the public
//! address the router gives it), and one on each other address of this machine, such as
//! IPv6 or a VPN like Tailscale.

use std::future::poll_fn;
use std::io;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::task::Poll;
use std::time::Duration;

use anyhow::{Context, Result};
use str0m::Candidate;
use tokio::io::ReadBuf;
use tracing::{debug, info, warn};

use crate::stun;

const STUN_TIMEOUT: Duration = Duration::from_millis(800);
const STUN_ATTEMPTS: usize = 3;
/// Other addresses offered beyond the main one. Virtual adapters can be many; each address
/// is one more pair for every guest to try.
const MAX_OTHER_ADDRESSES: usize = 6;

pub struct Endpoint {
    /// The main socket first.
    pub sockets: Vec<UdpSocket>,
    /// The main address, the public one when the router translates it, then the others.
    pub candidates: Vec<Candidate>,
}

/// Binds the main socket on `port` (0 picks a free one), then one socket on a free port on
/// each other usable address.
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

    let mut sockets = vec![socket];
    for other in other_addresses(ip) {
        match UdpSocket::bind(SocketAddr::new(other, 0)) {
            Ok(socket) => {
                let address = socket.local_addr()?;
                match Candidate::host(address, "udp") {
                    Ok(candidate) => {
                        debug!(%address, "also listening here");
                        candidates.push(candidate);
                        sockets.push(socket);
                    }
                    Err(error) => debug!(%address, %error, "address left out"),
                }
            }
            Err(error) => debug!(%other, %error, "address left out"),
        }
    }
    Ok(Endpoint {
        sockets,
        candidates,
    })
}

/// The address the system would send from to reach the Internet. Connecting a UDP
/// socket sends nothing; it only asks the routing table.
fn default_route_ip() -> Result<IpAddr> {
    let probe = UdpSocket::bind("0.0.0.0:0")?;
    probe.connect("1.1.1.1:53")?;
    Ok(probe.local_addr()?.ip())
}

/// This machine's other addresses a guest might reach: not the main one, not loopback,
/// not link-local (which needs an interface name to be used).
fn other_addresses(main: IpAddr) -> Vec<IpAddr> {
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    let mut found: Vec<IpAddr> = interfaces
        .into_iter()
        .map(|interface| interface.ip())
        .filter(|ip| *ip != main && usable(*ip))
        .collect();
    found.sort_by_key(|ip| (ip.is_ipv6(), *ip));
    found.dedup();
    found.truncate(MAX_OTHER_ADDRESSES);
    found
}

fn usable(ip: IpAddr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return false;
    }
    match ip {
        IpAddr::V4(v4) => !v4.is_link_local(),
        // fe80::/10
        IpAddr::V6(v6) => (v6.segments()[0] & 0xffc0) != 0xfe80,
    }
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

/// The open sockets, each with the address it listens on.
pub struct Sockets(Vec<(SocketAddr, tokio::net::UdpSocket)>);

impl Sockets {
    pub fn new(sockets: Vec<UdpSocket>) -> io::Result<Self> {
        sockets
            .into_iter()
            .map(|socket| {
                socket.set_nonblocking(true)?;
                let address = socket.local_addr()?;
                Ok((address, tokio::net::UdpSocket::from_std(socket)?))
            })
            .collect::<io::Result<_>>()
            .map(Self)
    }

    /// The main socket's address.
    pub fn main_address(&self) -> Option<SocketAddr> {
        self.0.first().map(|(address, _)| *address)
    }

    /// Sends from the socket at `from`, or from the main one if none is there. A send that
    /// would block is a lost packet, which WebRTC recovers from.
    pub fn send(&self, from: SocketAddr, to: SocketAddr, contents: &[u8]) -> io::Result<usize> {
        let socket = self
            .0
            .iter()
            .find(|(address, _)| *address == from)
            .or_else(|| self.0.first())
            .map(|(_, socket)| socket)
            .ok_or_else(|| io::Error::other("no socket"))?;
        socket.try_send_to(contents, to)
    }

    /// The next datagram on any socket: its length, where it came from, and the address
    /// of the socket that received it.
    pub async fn recv(&self, buffer: &mut [u8]) -> io::Result<(usize, SocketAddr, SocketAddr)> {
        poll_fn(|context| {
            for (address, socket) in &self.0 {
                let mut read = ReadBuf::new(buffer);
                match socket.poll_recv_from(context, &mut read) {
                    Poll::Ready(Ok(source)) => {
                        return Poll::Ready(Ok((read.filled().len(), source, *address)));
                    }
                    // One socket failing (an interface gone) must not end the game.
                    Poll::Ready(Err(error)) if self.0.len() > 1 && *address != self.0[0].0 => {
                        debug!(%address, %error, "datagram not read");
                    }
                    Poll::Ready(Err(error)) => return Poll::Ready(Err(error)),
                    Poll::Pending => {}
                }
            }
            Poll::Pending
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, Ipv6Addr};

    use super::*;

    #[test]
    fn loopback_and_link_local_addresses_are_left_out() {
        assert!(!usable(IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(!usable(IpAddr::V4(Ipv4Addr::new(169, 254, 3, 4))));
        assert!(!usable(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(!usable("fe80::1".parse().unwrap()));
        assert!(usable(IpAddr::V4(Ipv4Addr::new(100, 86, 206, 93))));
        assert!(usable("2a01:cb00::1".parse().unwrap()));
    }

    #[tokio::test]
    async fn a_datagram_on_any_socket_is_read_with_its_address() {
        let sockets = Sockets::new(vec![
            UdpSocket::bind("127.0.0.1:0").unwrap(),
            UdpSocket::bind("127.0.0.1:0").unwrap(),
        ])
        .unwrap();
        let second = sockets.0[1].0;
        let sender = UdpSocket::bind("127.0.0.1:0").unwrap();
        sender.send_to(b"hello", second).unwrap();
        let mut buffer = [0u8; 16];
        let (length, source, local) = sockets.recv(&mut buffer).await.unwrap();
        assert_eq!(&buffer[..length], b"hello");
        assert_eq!(source, sender.local_addr().unwrap());
        assert_eq!(local, second);
    }
}
