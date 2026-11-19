//! Just enough STUN (RFC 8489) to learn the host's public address: one Binding request,
//! one XOR-MAPPED-ADDRESS read from the answer. Guests then get that address as a
//! server-reflexive candidate and can reach the host through its NAT.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const MAGIC_COOKIE: u32 = 0x2112_A442;
const XOR_MAPPED_ADDRESS: u16 = 0x0020;
const HEADER_LEN: usize = 20;

pub type TransactionId = [u8; 12];

pub fn binding_request(transaction: TransactionId) -> Vec<u8> {
    let mut request = Vec::with_capacity(HEADER_LEN);
    request.extend(BINDING_REQUEST.to_be_bytes());
    request.extend(0u16.to_be_bytes());
    request.extend(MAGIC_COOKIE.to_be_bytes());
    request.extend(transaction);
    request
}

/// The mapped address in a Binding success response to `transaction`, if `packet` is one.
pub fn mapped_address(packet: &[u8], transaction: TransactionId) -> Option<SocketAddr> {
    if packet.len() < HEADER_LEN
        || u16::from_be_bytes([packet[0], packet[1]]) != BINDING_SUCCESS
        || packet[4..8] != MAGIC_COOKIE.to_be_bytes()
        || packet[8..20] != transaction
    {
        return None;
    }
    let length = usize::from(u16::from_be_bytes([packet[2], packet[3]]));
    let mut attributes = packet.get(HEADER_LEN..HEADER_LEN + length)?;
    while attributes.len() >= 4 {
        let kind = u16::from_be_bytes([attributes[0], attributes[1]]);
        let size = usize::from(u16::from_be_bytes([attributes[2], attributes[3]]));
        let value = attributes.get(4..4 + size)?;
        if kind == XOR_MAPPED_ADDRESS {
            return decode_xor_address(value, transaction);
        }
        // Attribute values are padded to a multiple of four bytes.
        attributes = attributes
            .get(4 + size.next_multiple_of(4)..)
            .unwrap_or_default();
    }
    None
}

fn decode_xor_address(value: &[u8], transaction: TransactionId) -> Option<SocketAddr> {
    let cookie = MAGIC_COOKIE.to_be_bytes();
    let port = u16::from_be_bytes([value.get(2)? ^ cookie[0], value.get(3)? ^ cookie[1]]);
    let ip = match value.get(1)? {
        0x01 => {
            let bytes: [u8; 4] = value.get(4..8)?.try_into().ok()?;
            IpAddr::V4(Ipv4Addr::from(std::array::from_fn(|i| {
                bytes[i] ^ cookie[i]
            })))
        }
        0x02 => {
            let bytes: [u8; 16] = value.get(4..20)?.try_into().ok()?;
            let mask: Vec<u8> = cookie.iter().chain(&transaction).copied().collect();
            IpAddr::V6(Ipv6Addr::from(std::array::from_fn(|i| bytes[i] ^ mask[i])))
        }
        _ => return None,
    };
    Some(SocketAddr::new(ip, port))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 5769, section 2.2: sample IPv4 response.
    const RFC_5769_RESPONSE: &str = concat!(
        "0101003c2112a442b7e7a701bc34d686fa87dfae",
        "8022000b7465737420766563746f7220",
        "00200008 0001a147e112a643",
        "000800142b91f599fd9e90c38c7489f92af9ba53f06be7d7",
        "80280004c07d4c96",
    );
    const RFC_5769_TRANSACTION: TransactionId = [
        0xb7, 0xe7, 0xa7, 0x01, 0xbc, 0x34, 0xd6, 0x86, 0xfa, 0x87, 0xdf, 0xae,
    ];

    fn bytes(hex: &str) -> Vec<u8> {
        let hex: String = hex.chars().filter(|c| !c.is_whitespace()).collect();
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn reads_the_rfc_5769_sample() {
        let response = bytes(RFC_5769_RESPONSE);
        assert_eq!(
            mapped_address(&response, RFC_5769_TRANSACTION),
            Some("192.0.2.1:32853".parse().unwrap())
        );
    }

    #[test]
    fn ignores_answers_to_another_request() {
        let response = bytes(RFC_5769_RESPONSE);
        assert_eq!(mapped_address(&response, [0; 12]), None);
    }

    #[test]
    fn survives_a_truncated_packet() {
        let response = bytes(RFC_5769_RESPONSE);
        for end in 0..response.len() {
            let _ = mapped_address(&response[..end], RFC_5769_TRANSACTION);
        }
    }

    #[test]
    fn builds_a_binding_request() {
        let request = binding_request([7; 12]);
        assert_eq!(
            &request[..8],
            &[0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xa4, 0x42]
        );
        assert_eq!(&request[8..], &[7; 12]);
    }
}
