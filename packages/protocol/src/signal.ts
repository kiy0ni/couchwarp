/**
 * JSON messages relayed by the room server over WebSockets.
 * The Rust side of the host messages: `crates/protocol/src/signal.rs`.
 */

import { type ChatMessage, type HostCommand, parseHostCommand, type RoomState } from './room'
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
  | 'kicked'
  | 'banned'
  | 'room-closed'
  | 'console-key-invalid'
  | 'refused'

export type EdgeToHost =
  /** `consoleKey` opens the host console, a page to manage the room from any device. */
  | { type: 'room-created'; code: string; consoleKey: string }
  | { type: 'guest-joined'; guestId: GuestId; name: string }
  | { type: 'guest-left'; guestId: GuestId }
  | { type: 'signal'; from: GuestId; payload: SignalPayload }
  | { type: 'room-state'; state: RoomState }
  | { type: 'chat'; message: ChatMessage }

export type HostToEdge = { type: 'signal'; to: GuestId; payload: SignalPayload } | HostCommand

export type EdgeToGuest =
  /** `relayOnly`: connect through the relay only, so the host never sees this address. */
  | { type: 'welcome'; guestId: GuestId; iceServers: IceServer[]; relayOnly: boolean }
  | { type: 'signal'; payload: SignalPayload }
  | { type: 'rejected'; reason: RejectReason }
  | { type: 'host-left' }
  | { type: 'room-state'; state: RoomState }
  | { type: 'chat'; message: ChatMessage }
  /** At the door: the host has not said yes yet. `welcome` follows once they do. */
  | { type: 'waiting' }

/** Guests send commands too: chat for everyone, the rest only as moderators. */
export type GuestToEdge =
  | { type: 'signal'; payload: SignalPayload }
  | { type: 'raise-hand'; raised: boolean }
  | HostCommand

export type ConsoleToEdge = { type: 'auth'; key: string } | HostCommand

export type EdgeToConsole =
  | { type: 'room-state'; state: RoomState }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'rejected'; reason: RejectReason }

/** Longest SDP accepted from the network. Real offers stay under 10 kB. */
const MAX_SDP_LENGTH = 64 * 1024
const MAX_GUEST_ID = 2 ** 32 - 1

const REJECT_REASONS: readonly RejectReason[] = [
  'room-not-found',
  'room-full',
  'invalid-name',
  'host-already-connected',
  'kicked',
  'banned',
  'room-closed',
  'console-key-invalid',
  'refused',
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
  if (message?.type === 'signal') {
    const payload = parsePayload(message.payload)
    return payload ? { type: 'signal', payload } : null
  }
  if (message?.type === 'raise-hand') {
    return typeof message.raised === 'boolean'
      ? { type: 'raise-hand', raised: message.raised }
      : null
  }
  return parseHostCommand(message)
}

export function parseConsoleToEdge(text: string): ConsoleToEdge | null {
  const message = parseObject(text)
  if (message?.type === 'auth') {
    return typeof message.key === 'string' && message.key.length <= 128
      ? { type: 'auth', key: message.key }
      : null
  }
  return parseHostCommand(message)
}

export function parseHostToEdge(text: string): HostToEdge | null {
  const message = parseObject(text)
  if (message?.type !== 'signal') return parseHostCommand(message)
  if (!isInteger(message.to, 0, MAX_GUEST_ID)) return null
  const payload = parsePayload(message.payload)
  return payload ? { type: 'signal', to: message.to, payload } : null
}

export function parseEdgeToGuest(text: string): EdgeToGuest | null {
  const message = parseObject(text)
  switch (message?.type) {
    case 'welcome': {
      if (
        !isInteger(message.guestId, 0, MAX_GUEST_ID) ||
        !Array.isArray(message.iceServers) ||
        typeof message.relayOnly !== 'boolean'
      ) {
        return null
      }
      const iceServers = message.iceServers.map(parseIceServer)
      if (iceServers.some((server) => server === null)) return null
      return {
        type: 'welcome',
        guestId: message.guestId,
        iceServers: iceServers as IceServer[],
        relayOnly: message.relayOnly,
      }
    }
    case 'room-state':
    case 'chat':
      return roomUpdate(message)
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
    case 'waiting':
      return { type: 'waiting' }
    default:
      return null
  }
}

/**
 * Room state and chat come from our own room server, after it validated every input;
 * only their envelope is checked here.
 */
function roomUpdate(message: Record<string, unknown>): EdgeToGuest | null {
  if (message.type === 'room-state') {
    const state = asObject(message.state)
    return state && Array.isArray(state.members)
      ? { type: 'room-state', state: state as unknown as RoomState }
      : null
  }
  const chat = asObject(message.message)
  return chat && typeof chat.text === 'string'
    ? { type: 'chat', message: chat as unknown as ChatMessage }
    : null
}

export function parseEdgeToConsole(text: string): EdgeToConsole | null {
  const message = parseObject(text)
  if (message?.type === 'rejected') {
    const parsed = parseEdgeToGuest(text)
    return parsed?.type === 'rejected' ? parsed : null
  }
  if (message?.type === 'room-state' || message?.type === 'chat') {
    return roomUpdate(message) as EdgeToConsole | null
  }
  return null
}
