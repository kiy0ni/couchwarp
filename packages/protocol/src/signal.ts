/**
 * JSON messages relayed by the room server over WebSockets.
 * The Rust side of the host messages: `crates/protocol/src/signal.rs`.
 */

import { asObject, isInteger, parseObject } from './validate'

export type GuestId = number

/** WebRTC negotiation. The guest always makes the offer; the host answers. */
export type SignalPayload =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: string; sdpMid: string | null }

export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

export type RejectReason =
  | 'room-not-found'
  | 'room-full'
  | 'invalid-name'
  | 'host-already-connected'

export type EdgeToHost =
  | { type: 'room-created'; code: string }
  | { type: 'guest-joined'; guestId: GuestId; name: string }
  | { type: 'guest-left'; guestId: GuestId }
  | { type: 'signal'; from: GuestId; payload: SignalPayload }

export type HostToEdge = { type: 'signal'; to: GuestId; payload: SignalPayload }

export type EdgeToGuest =
  | { type: 'welcome'; guestId: GuestId; iceServers: IceServer[] }
  | { type: 'signal'; payload: SignalPayload }
  | { type: 'rejected'; reason: RejectReason }
  | { type: 'host-left' }

export type GuestToEdge = { type: 'signal'; payload: SignalPayload }

/** Longest SDP accepted from the network. Real offers stay under 10 kB. */
const MAX_SDP_LENGTH = 64 * 1024
const MAX_GUEST_ID = 2 ** 32 - 1

const REJECT_REASONS: readonly RejectReason[] = [
  'room-not-found',
  'room-full',
  'invalid-name',
  'host-already-connected',
]

function parsePayload(value: unknown): SignalPayload | null {
  const payload = asObject(value)
  if (!payload) return null
  const { kind, sdp, candidate, sdpMid } = payload
  if ((kind === 'offer' || kind === 'answer') && typeof sdp === 'string') {
    return sdp.length <= MAX_SDP_LENGTH ? { kind, sdp } : null
  }
  if (
    kind === 'candidate' &&
    typeof candidate === 'string' &&
    candidate.length <= 1024 &&
    (sdpMid === null || typeof sdpMid === 'string')
  ) {
    return { kind, candidate, sdpMid }
  }
  return null
}

function parseIceServer(value: unknown): IceServer | null {
  const server = asObject(value)
  if (!server || !Array.isArray(server.urls)) return null
  if (!server.urls.every((url) => typeof url === 'string')) return null
  const parsed: IceServer = { urls: server.urls as string[] }
  if (typeof server.username === 'string') parsed.username = server.username
  if (typeof server.credential === 'string') parsed.credential = server.credential
  return parsed
}

export function parseGuestToEdge(text: string): GuestToEdge | null {
  const message = parseObject(text)
  if (message?.type !== 'signal') return null
  const payload = parsePayload(message.payload)
  return payload ? { type: 'signal', payload } : null
}

export function parseHostToEdge(text: string): HostToEdge | null {
  const message = parseObject(text)
  if (message?.type !== 'signal' || !isInteger(message.to, 0, MAX_GUEST_ID)) return null
  const payload = parsePayload(message.payload)
  return payload ? { type: 'signal', to: message.to, payload } : null
}

export function parseEdgeToGuest(text: string): EdgeToGuest | null {
  const message = parseObject(text)
  switch (message?.type) {
    case 'welcome': {
      if (!isInteger(message.guestId, 0, MAX_GUEST_ID) || !Array.isArray(message.iceServers)) {
        return null
      }
      const iceServers = message.iceServers.map(parseIceServer)
      if (iceServers.some((server) => server === null)) return null
      return { type: 'welcome', guestId: message.guestId, iceServers: iceServers as IceServer[] }
    }
    case 'signal': {
      const payload = parsePayload(message.payload)
      return payload ? { type: 'signal', payload } : null
    }
    case 'rejected':
      return REJECT_REASONS.includes(message.reason as RejectReason)
        ? { type: 'rejected', reason: message.reason as RejectReason }
        : null
    case 'host-left':
      return { type: 'host-left' }
    default:
      return null
  }
}
