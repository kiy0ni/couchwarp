import { DurableObject } from 'cloudflare:workers'
import {
  type EdgeToConsole,
  type EdgeToGuest,
  type EdgeToHost,
  type GuestId,
  type HostCommand,
  parseConsoleToEdge,
  parseGuestToEdge,
  parseHostToEdge,
  type RejectReason,
} from '@couchwarp/protocol'
import { publish, unpublish } from './directory'
import { lookUpGame } from './games'
import { iceServersFor } from './ice'
import { factsFrom } from './reports'
import {
  type Account,
  type Actor,
  type Grants,
  NO_GRANTS,
  type Policy,
  RoomModel,
  type Snapshot,
} from './room-model'

const MAX_NAME_LENGTH = 24
/** A thumbnail is a small JPEG; anything bigger is refused. */
const MAX_THUMBNAIL_BYTES = 128 * 1024
/** How often a room wakes up to refresh its public row and check the turn timer. */
const HEARTBEAT_MS = 60 * 1000

type Peer =
  | { role: 'host' }
  | { role: 'guest'; guestId: GuestId }
  | { role: 'console'; authed: boolean }

/** What every peer receives: the room state, and chat. */
type Broadcast = Extract<EdgeToGuest, { type: 'room-state' | 'chat' }>

/** Facts the Worker resolved before handing the request over. */
export interface Arrival {
  account: Account | null
  /** SHA-256 of the network address, for bans that survive a new nickname. */
  addressHash: string
  country: string | null
  continent: string | null
}

export const ARRIVAL_HEADER = 'X-Couchwarp-Arrival'

/** WebSocket close codes in the private range, one per rejection. */
const CLOSE_CODES: Record<RejectReason, number> = {
  'room-not-found': 4404,
  'room-full': 4409,
  'invalid-name': 4400,
  'host-already-connected': 4403,
  kicked: 4410,
  banned: 4411,
  'room-closed': 4412,
  'console-key-invalid': 4401,
}

interface Meta {
  code: string
  consoleKey: string
  nextGuestId: number
  country: string | null
  continent: string | null
  hasThumbnail: boolean
}

/**
 * One room: the host's WebSocket, its guests', and the host consoles. It relays WebRTC
 * negotiation, keeps the room state (`RoomModel`) and sends it out after every change.
 * Uses the hibernation API, so an idle room costs nothing.
 *
 * Routes, called by the Worker: `/<code>/host`, `/<code>/guest?name=`, `/<code>/console`,
 * `/<code>/info`, `/<code>/thumbnail`, `/<code>/facts?guestId=` (for a report) and
 * `/<code>/admin-close`. The last two are never routed from outside the Worker.
 */
export class Room extends DurableObject<Env> {
  private model: RoomModel | null = null

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const [, code = '', route] = url.pathname.split('/')
    const header = request.headers.get(ARRIVAL_HEADER)
    const arrival = header ? (JSON.parse(decodeURIComponent(header)) as Arrival) : null
    switch (route) {
      case 'info':
        return Response.json(await this.info())
      case 'thumbnail':
        return this.thumbnail()
      case 'facts': {
        const model = this.hostSocket() ? this.load() : null
        const guestId = url.searchParams.get('guestId')
        return Response.json(
          factsFrom(model?.state(this.policy()) ?? null, guestId ? Number(guestId) : null),
        )
      }
      case 'admin-close': {
        const model = this.load()
        if (model) await this.close(model)
        return new Response(null, { status: 204 })
      }
      case 'console':
        return this.acceptConsole()
      case 'host':
        return arrival ? this.acceptHost(code, arrival) : new Response(null, { status: 400 })
      case 'guest':
        return arrival
          ? this.acceptGuest(url.searchParams.get('name') ?? '', arrival)
          : new Response(null, { status: 400 })
      default:
        return new Response('Not found', { status: 404 })
    }
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const peer = socket.deserializeAttachment() as Peer
    const model = this.load()
    if (!model) {
      socket.close(1011, 'room gone')
    } else if (peer.role === 'host' && message instanceof ArrayBuffer) {
      await this.storeThumbnail(model, message)
    } else if (typeof message !== 'string') {
      socket.close(1003, 'text messages only')
    } else if (peer.role === 'host') {
      await this.fromHost(socket, model, message)
    } else if (peer.role === 'guest') {
      await this.fromGuest(socket, model, peer.guestId, message)
    } else {
      await this.fromConsole(socket, model, peer.authed, message)
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.leave(socket)
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.leave(socket)
  }

  /** Keeps the public row fresh and ends timed turns, while the host is here. */
  override async alarm(): Promise<void> {
    const model = this.load()
    if (!model || !this.hostSocket()) return
    const now = Date.now()
    if (model.turnEndsAt !== null && model.turnEndsAt <= now) model.nextTurn(now)
    await this.changed(model)
  }

  private async fromHost(socket: WebSocket, model: RoomModel, text: string): Promise<void> {
    const parsed = parseHostToEdge(text)
    if (!parsed) {
      socket.close(1008, 'invalid message')
    } else if (parsed.type === 'signal') {
      this.guestSocket(parsed.to)?.send(
        json<EdgeToGuest>({ type: 'signal', payload: parsed.payload }),
      )
    } else {
      await this.command(model, { kind: 'host' }, parsed)
    }
  }

  private async fromGuest(
    socket: WebSocket,
    model: RoomModel,
    guestId: GuestId,
    text: string,
  ): Promise<void> {
    const parsed = parseGuestToEdge(text)
    if (!parsed) {
      socket.close(1008, 'invalid message')
    } else if (parsed.type === 'signal') {
      this.hostSocket()?.send(
        json<EdgeToHost>({ type: 'signal', from: guestId, payload: parsed.payload }),
      )
    } else if (parsed.type === 'raise-hand') {
      if (model.raiseHand(guestId, parsed.raised).ok) await this.changed(model)
    } else {
      await this.command(model, { kind: 'guest', guestId }, parsed)
    }
  }

  private async fromConsole(
    socket: WebSocket,
    model: RoomModel,
    authed: boolean,
    text: string,
  ): Promise<void> {
    const parsed = parseConsoleToEdge(text)
    if (!parsed) {
      socket.close(1008, 'invalid message')
    } else if (parsed.type === 'auth') {
      if (!(await this.consoleKeyMatches(parsed.key))) {
        reject(socket, 'console-key-invalid')
        return
      }
      socket.serializeAttachment({ role: 'console', authed: true } satisfies Peer)
      socket.send(json<EdgeToConsole>({ type: 'room-state', state: model.state(this.policy()) }))
      for (const message of model.chatHistory) {
        socket.send(json<EdgeToConsole>({ type: 'chat', message }))
      }
    } else if (authed) {
      await this.command(model, { kind: 'host' }, parsed)
    } else {
      socket.close(1008, 'authenticate first')
    }
  }

  private async acceptHost(code: string, arrival: Arrival): Promise<Response> {
    if (this.hostSocket()) {
      // The Worker drew a code already in use; it draws another.
      return new Response('Room code taken', { status: 409 })
    }
    const model = RoomModel.create(code, {
      name: arrival.account?.displayName ?? '',
      userId: arrival.account?.userId ?? null,
    })
    this.model = model
    const meta: Meta = {
      code,
      consoleKey: randomKey(),
      nextGuestId: 1,
      country: arrival.country,
      continent: arrival.continent,
      hasThumbnail: false,
    }
    this.ctx.storage.kv.put('meta', meta)
    this.ctx.storage.kv.delete('thumbnail')

    const [client, server] = pair()
    this.ctx.acceptWebSocket(server, ['host'])
    server.serializeAttachment({ role: 'host' } satisfies Peer)
    server.send(json<EdgeToHost>({ type: 'room-created', code, consoleKey: meta.consoleKey }))
    if (arrival.account) await this.recordJoin(model, arrival.account.userId, true)
    await this.changed(model)
    return new Response(null, { status: 101, webSocket: client })
  }

  private async acceptGuest(rawName: string, arrival: Arrival): Promise<Response> {
    const model = this.load()
    if (!model || !this.hostSocket()) return rejection('room-not-found')
    const name = cleanGuestName(rawName || arrival.account?.displayName || '')
    if (name === null) return rejection('invalid-name')

    const meta = this.meta()
    const guestId = meta.nextGuestId
    // Ids are never reused within a room, so a late message cannot reach the wrong guest.
    this.ctx.storage.kv.put('meta', { ...meta, nextGuestId: guestId + 1 })
    const banKeys = [`ip:${arrival.addressHash}`]
    if (arrival.account) banKeys.push(`user:${arrival.account.userId}`)
    const grants = arrival.account
      ? await this.friendGrants(model, arrival.account.userId)
      : NO_GRANTS
    const joined = model.join(guestId, name, arrival.account, banKeys, Date.now(), grants)
    if (typeof joined === 'string') return rejection(joined)

    const [client, server] = pair()
    this.ctx.acceptWebSocket(server, [guestTag(guestId)])
    server.serializeAttachment({ role: 'guest', guestId } satisfies Peer)
    const iceServers = await iceServersFor(this.env)
    server.send(
      json<EdgeToGuest>({
        type: 'welcome',
        guestId,
        iceServers,
        // Strangers join public games: there, guests always go through the relay.
        relayOnly:
          (model.settings.relayOnly || model.settings.visibility === 'public') &&
          hasRelay(iceServers),
      }),
    )
    for (const message of model.chatHistory) {
      server.send(json<EdgeToGuest>({ type: 'chat', message }))
    }
    this.hostSocket()?.send(json<EdgeToHost>({ type: 'guest-joined', guestId, name }))
    if (arrival.account) await this.recordJoin(model, arrival.account.userId)
    await this.changed(model)
    return new Response(null, { status: 101, webSocket: client })
  }

  private acceptConsole(): Response {
    if (!this.hostSocket()) return rejection('room-not-found')
    const [client, server] = pair()
    this.ctx.acceptWebSocket(server, ['console'])
    server.serializeAttachment({ role: 'console', authed: false } satisfies Peer)
    return new Response(null, { status: 101, webSocket: client })
  }

  private async command(model: RoomModel, actor: Actor, command: HostCommand): Promise<void> {
    const now = Date.now()
    const target = 'guestId' in command ? model.member(command.guestId) : undefined
    const outcome = model.apply(actor, command, now)
    if (!outcome.ok) return
    if (command.type === 'kick' || command.type === 'set-role') {
      const action =
        command.type === 'kick' ? (command.ban ? 'ban' : 'kick') : `role:${command.role}`
      await this.audit(model, actor, action, target)
    }
    if (outcome.closed) {
      await this.close(model)
      return
    }
    if (outcome.chat) {
      this.broadcast({ type: 'chat', message: outcome.chat })
      this.persist(model)
      return
    }
    if (outcome.kicked !== undefined) {
      const kicked = this.guestSocket(outcome.kicked)
      if (kicked) reject(kicked, command.type === 'kick' && command.ban ? 'banned' : 'kicked')
      model.leave(outcome.kicked, now)
      this.hostSocket()?.send(json<EdgeToHost>({ type: 'guest-left', guestId: outcome.kicked }))
    }
    await this.changed(model)
  }

  private async leave(socket: WebSocket): Promise<void> {
    const peer = socket.deserializeAttachment() as Peer
    const model = this.load()
    if (!model) return
    if (peer.role === 'host') {
      await this.close(model)
      return
    }
    if (peer.role !== 'guest') return
    const member = model.member(peer.guestId)
    if (!member) return
    model.leave(peer.guestId, Date.now())
    this.hostSocket()?.send(json<EdgeToHost>({ type: 'guest-left', guestId: peer.guestId }))
    if (member.userId) await this.recordLeave(model, member.userId)
    await this.changed(model)
  }

  /** Ends the room: everyone is told, the listing goes, the storage is wiped. */
  private async close(model: RoomModel): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue
      const peer = socket.deserializeAttachment() as Peer
      if (peer.role === 'guest') socket.send(json<EdgeToGuest>({ type: 'host-left' }))
      if (peer.role === 'console') {
        socket.send(json<EdgeToConsole>({ type: 'rejected', reason: 'room-closed' }))
      }
      socket.close(1000, 'room closed')
    }
    // Gone before the first await: a socket closing meanwhile finds no room to leave.
    this.ctx.storage.kv.delete('room')
    this.ctx.storage.kv.delete('meta')
    this.ctx.storage.kv.delete('thumbnail')
    this.model = null
    await this.ctx.storage.deleteAlarm()
    await unpublish(this.env.DB, model.code)
    await this.env.DB.prepare(
      'UPDATE play_history SET left_at = ? WHERE room_code = ? AND left_at IS NULL',
    )
      .bind(Date.now(), model.code)
      .run()
  }

  /** After any change: save, tell everyone, update the public list, plan the next check. */
  private async changed(model: RoomModel): Promise<void> {
    this.persist(model)
    const state = model.state(this.policy())
    this.broadcast({ type: 'room-state', state })
    const now = Date.now()
    const meta = this.meta()
    if (model.effectiveVisibility(this.policy()) === 'public') {
      const players = model.players()
      await publish(
        this.env.DB,
        {
          code: model.code,
          title: model.settings.title,
          game: model.settings.game,
          hostName: model.host.name,
          hostUserId: model.host.userId,
          players: players.length,
          maxPlayers: model.settings.maxPlayers,
          spectators: state.members.length - players.length,
          country: meta.country,
          continent: meta.continent,
          avatars: players.map((member) => member.avatarUrl),
          hasThumbnail: meta.hasThumbnail,
        },
        now,
      )
    } else {
      await unpublish(this.env.DB, model.code)
    }
    await this.ctx.storage.setAlarm(Math.min(model.turnEndsAt ?? Infinity, now + HEARTBEAT_MS))
  }

  private broadcast(message: Broadcast): void {
    const text = JSON.stringify(message)
    for (const socket of this.ctx.getWebSockets()) {
      const peer = socket.deserializeAttachment() as Peer
      // A socket being closed (a refused console, a kicked guest) is still listed briefly.
      if (socket.readyState !== WebSocket.OPEN) continue
      if (peer.role !== 'console' || peer.authed) socket.send(text)
    }
  }

  private async audit(
    model: RoomModel,
    actor: Actor,
    action: string,
    target: { name: string; userId: string | null } | undefined,
  ): Promise<void> {
    const actorName =
      actor.kind === 'host'
        ? `host:${model.host.name}`
        : `guest:${model.member(actor.guestId)?.name}`
    await this.env.DB.prepare(
      'INSERT INTO moderation_log (room_code, actor, action, target_name, target_user_id, at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(model.code, actorName, action, target?.name ?? '?', target?.userId ?? null, Date.now())
      .run()
  }

  /** What the host lets this friend do from the start, when the host is signed in. */
  private async friendGrants(model: RoomModel, userId: string): Promise<Grants> {
    if (!model.host.userId || model.host.userId === userId) return NO_GRANTS
    const row = await this.env.DB.prepare(
      `SELECT p.keyboard, p.mouse FROM friend_permissions p
       JOIN friendships f ON f.accepted_at IS NOT NULL
         AND ((f.requester_id = p.owner_id AND f.addressee_id = p.friend_id)
           OR (f.requester_id = p.friend_id AND f.addressee_id = p.owner_id))
       WHERE p.owner_id = ? AND p.friend_id = ?`,
    )
      .bind(model.host.userId, userId)
      .first<{ keyboard: number; mouse: number }>()
    return row ? { keyboard: row.keyboard === 1, mouse: row.mouse === 1 } : NO_GRANTS
  }

  private async recordJoin(model: RoomModel, userId: string, hosted = false): Promise<void> {
    await this.env.DB.prepare(
      'INSERT INTO play_history (user_id, room_code, title, game, host_name, joined_at, hosted) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        userId,
        model.code,
        model.settings.title,
        model.settings.game,
        model.host.name,
        Date.now(),
        hosted ? 1 : 0,
      )
      .run()
  }

  private async recordLeave(model: RoomModel, userId: string): Promise<void> {
    await this.env.DB.prepare(
      'UPDATE play_history SET left_at = ? WHERE user_id = ? AND room_code = ? AND left_at IS NULL',
    )
      .bind(Date.now(), userId, model.code)
      .run()
  }

  /** Kept only for a public room, and only if it is a JPEG of a sensible size. */
  private async storeThumbnail(model: RoomModel, bytes: ArrayBuffer): Promise<void> {
    if (bytes.byteLength > MAX_THUMBNAIL_BYTES || !isJpeg(bytes) || !this.isListed(model)) return
    this.ctx.storage.kv.put('thumbnail', bytes)
    const meta = this.meta()
    if (!meta.hasThumbnail) {
      this.ctx.storage.kv.put('meta', { ...meta, hasThumbnail: true })
      // The list learns about the first picture now rather than at the next refresh.
      await this.changed(model)
    }
  }

  /** A room that stops being public stops showing its picture at once. */
  private thumbnail(): Response {
    const model = this.load()
    const bytes = this.ctx.storage.kv.get<ArrayBuffer>('thumbnail')
    if (!model || !bytes || !this.isListed(model)) {
      return new Response('No thumbnail', { status: 404 })
    }
    return new Response(bytes, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=10',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  private isListed(model: RoomModel): boolean {
    return model.effectiveVisibility(this.policy()) === 'public'
  }

  private async consoleKeyMatches(key: string): Promise<boolean> {
    // Comparing digests means the time taken says nothing about how much of the key matched.
    const [given, expected] = await Promise.all([digest(key), digest(this.meta().consoleKey)])
    return given.every((byte, i) => byte === expected[i])
  }

  private load(): RoomModel | null {
    if (this.model) return this.model
    const snapshot = this.ctx.storage.kv.get<Snapshot>('room')
    const meta = this.ctx.storage.kv.get<Meta>('meta')
    if (!snapshot || !meta) return null
    this.model = RoomModel.restore(meta.code, snapshot)
    return this.model
  }

  private persist(model: RoomModel): void {
    this.ctx.storage.kv.put('room', model.save())
  }

  private meta(): Meta {
    const meta = this.ctx.storage.kv.get<Meta>('meta')
    if (!meta) throw new Error('room metadata missing')
    return meta
  }

  private policy(): Policy {
    return {
      publicRoomsEnabled: this.env.PUBLIC_ROOMS === 'on',
      relayAvailable: Boolean(this.env.TURN_KEY_ID && this.env.TURN_KEY_API_TOKEN),
    }
  }

  /** What the join page shows before asking a name: the code alone opens this much. */
  private async info() {
    const model = this.hostSocket() ? this.load() : null
    if (!model) return { open: false }
    const state = model.state(this.policy())
    const seated = state.members.filter((member) => member.role !== 'spectator').length
    const known = state.settings.game
      ? await lookUpGame(this.env.DB, state.settings.game, Date.now())
      : null
    return {
      open: true,
      room: {
        title: state.settings.title,
        game: known?.name ?? state.settings.game,
        cover: known?.cover ?? null,
        header: known?.header ?? null,
        hostName: state.hostName,
        players: seated,
        maxPlayers: state.settings.maxPlayers,
        spectators: state.members.length - seated,
        // Guests go through the relay, so the host does not see their address.
        addressesHidden:
          state.relayAvailable &&
          (state.settings.relayOnly || state.settings.visibility === 'public'),
      },
    }
  }

  private hostSocket(): WebSocket | undefined {
    return this.ctx.getWebSockets('host')[0]
  }

  private guestSocket(guestId: GuestId): WebSocket | undefined {
    return this.ctx.getWebSockets(guestTag(guestId))[0]
  }
}

/** JPEG files start with a start-of-image marker followed by another marker. */
function isJpeg(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength))
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
}

function pair(): [WebSocket, WebSocket] {
  return Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
}

/** Rejected guests still get a WebSocket, so the page can say why. */
function rejection(reason: RejectReason): Response {
  const [client, server] = pair()
  server.accept()
  reject(server, reason)
  return new Response(null, { status: 101, webSocket: client })
}

function reject(socket: WebSocket, reason: RejectReason): void {
  socket.send(json<EdgeToGuest>({ type: 'rejected', reason }))
  socket.close(CLOSE_CODES[reason], reason)
}

function hasRelay(servers: { urls: string[] }[]): boolean {
  return servers.some((server) => server.urls.some((url) => url.startsWith('turn')))
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
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
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim()
  const length = [...name].length
  return length > 0 && length <= MAX_NAME_LENGTH ? name : null
}
