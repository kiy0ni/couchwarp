import { DurableObject } from 'cloudflare:workers'
import {
  type EdgeToGuest,
  type EdgeToHost,
  type GuestId,
  parseGuestToEdge,
  parseHostToEdge,
  type RejectReason,
} from '@couchwarp/protocol'
import { iceServersFor } from './ice'

/** Guests per room. Eight controller slots, so more guests could never all play. */
export const MAX_GUESTS = 8
const MAX_NAME_LENGTH = 24

type Peer = { role: 'host' } | { role: 'guest'; guestId: GuestId; name: string }

/** WebSocket close codes in the private range, one per rejection. */
const CLOSE_CODES: Record<RejectReason, number> = {
  'room-not-found': 4404,
  'room-full': 4409,
  'invalid-name': 4400,
  'host-already-connected': 4403,
}

/**
 * One room: the host's WebSocket and its guests'. It relays WebRTC negotiation
 * between them and nothing else. Uses the hibernation API, so an idle room costs nothing.
 *
 * Routes, called by the Worker: `/<code>/host`, `/<code>/guest?name=`, `/<code>/info`.
 */
export class Room extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const [, code = '', route] = url.pathname.split('/')
    switch (route) {
      case 'info':
        return Response.json({ open: this.host() !== undefined })
      case 'host':
        return this.acceptHost(code)
      case 'guest':
        return this.acceptGuest(url.searchParams.get('name') ?? '')
      default:
        return new Response('Not found', { status: 404 })
    }
  }

  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') {
      socket.close(1003, 'text messages only')
      return
    }
    const peer = socket.deserializeAttachment() as Peer
    const relayed =
      peer.role === 'host'
        ? this.relayFromHost(message)
        : this.relayFromGuest(peer.guestId, message)
    if (!relayed) socket.close(1008, 'invalid message')
  }

  /** False when the message is not valid. A guest that already left is not an error. */
  private relayFromHost(message: string): boolean {
    const parsed = parseHostToEdge(message)
    if (!parsed) return false
    this.guestSocket(parsed.to)?.send(
      json<EdgeToGuest>({ type: 'signal', payload: parsed.payload }),
    )
    return true
  }

  private relayFromGuest(guestId: GuestId, message: string): boolean {
    const parsed = parseGuestToEdge(message)
    if (!parsed) return false
    this.host()?.send(json<EdgeToHost>({ type: 'signal', from: guestId, payload: parsed.payload }))
    return true
  }

  override webSocketClose(socket: WebSocket): void {
    this.leave(socket)
  }

  override webSocketError(socket: WebSocket): void {
    this.leave(socket)
  }

  private acceptHost(code: string): Response {
    if (this.host()) {
      // The Worker drew a code already in use; it draws another.
      return new Response('Room code taken', { status: 409 })
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server, ['host'])
    server.serializeAttachment({ role: 'host' } satisfies Peer)
    server.send(json<EdgeToHost>({ type: 'room-created', code }))
    return new Response(null, { status: 101, webSocket: client })
  }

  private async acceptGuest(rawName: string): Promise<Response> {
    const host = this.host()
    const name = cleanGuestName(rawName)
    if (!host) return reject('room-not-found')
    if (name === null) return reject('invalid-name')
    if (this.guestCount() >= MAX_GUESTS) return reject('room-full')

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    const guestId = this.nextGuestId()
    this.ctx.acceptWebSocket(server, [guestTag(guestId)])
    server.serializeAttachment({ role: 'guest', guestId, name } satisfies Peer)
    server.send(
      json<EdgeToGuest>({ type: 'welcome', guestId, iceServers: await iceServersFor(this.env) }),
    )
    host.send(json<EdgeToHost>({ type: 'guest-joined', guestId, name }))
    return new Response(null, { status: 101, webSocket: client })
  }

  private leave(socket: WebSocket): void {
    const peer = socket.deserializeAttachment() as Peer
    if (peer.role === 'host') {
      for (const guest of this.guestSockets()) {
        guest.send(json<EdgeToGuest>({ type: 'host-left' }))
        guest.close(1000, 'host left')
      }
    } else {
      this.host()?.send(json<EdgeToHost>({ type: 'guest-left', guestId: peer.guestId }))
    }
  }

  private host(): WebSocket | undefined {
    return this.ctx.getWebSockets('host')[0]
  }

  private guestSocket(guestId: GuestId): WebSocket | undefined {
    return this.ctx.getWebSockets(guestTag(guestId))[0]
  }

  private guestSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => socket !== this.host())
  }

  private guestCount(): number {
    return this.guestSockets().length
  }

  /** Ids are never reused within a room, so a late message cannot reach the wrong guest. */
  private nextGuestId(): GuestId {
    const id = this.ctx.storage.kv.get<GuestId>('nextGuestId') ?? 1
    this.ctx.storage.kv.put('nextGuestId', id + 1)
    return id
  }
}

/** Rejected guests still get a WebSocket, so the page can say why. */
function reject(reason: RejectReason): Response {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
  server.accept()
  server.send(json<EdgeToGuest>({ type: 'rejected', reason }))
  server.close(CLOSE_CODES[reason], reason)
  return new Response(null, { status: 101, webSocket: client })
}

function guestTag(guestId: GuestId): string {
  return `guest:${guestId}`
}

function json<T>(message: T): string {
  return JSON.stringify(message)
}

/** Trims, collapses inner spaces and drops control characters. Null if nothing is left or too long. */
export function cleanGuestName(raw: string): string | null {
  const name = raw
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  const length = [...name].length
  return length > 0 && length <= MAX_NAME_LENGTH ? name : null
}
