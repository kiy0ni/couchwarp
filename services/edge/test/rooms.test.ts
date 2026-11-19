import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { DEFAULT_SETTINGS, isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanGuestName } from '../src/room'
import { randomRoomCode } from '../src/room-code'
import { MAX_MEMBERS } from '../src/room-model'

type Message = { type: string } & Record<string, unknown>

/** A test-side WebSocket that queues incoming messages until the test asks for them. */
class Peer {
  private readonly inbox: Message[] = []
  private readonly waiting: { type: string; resolve: (message: Message) => void }[] = []
  closeCode: number | null = null

  constructor(readonly socket: WebSocket) {
    socket.accept()
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      const message = JSON.parse(event.data) as Message
      const index = this.waiting.findIndex((waiter) => waiter.type === message.type)
      const waiter = index === -1 ? undefined : this.waiting.splice(index, 1)[0]
      if (waiter) waiter.resolve(message)
      else this.inbox.push(message)
    })
    socket.addEventListener('close', (event) => {
      this.closeCode = event.code
    })
  }

  /** The next message of this type, skipping others (room states arrive often). */
  next(type: string): Promise<Message> {
    const index = this.inbox.findIndex((message) => message.type === type)
    if (index !== -1) return Promise.resolve(this.inbox.splice(index, 1)[0] as Message)
    return new Promise((resolve) => this.waiting.push({ type, resolve }))
  }

  /** The latest room state received so far, waiting for one if none came yet. */
  async latestState(): Promise<Record<string, unknown>> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    const states = this.inbox.filter((message) => message.type === 'room-state')
    const others = this.inbox.filter((message) => message.type !== 'room-state')
    this.inbox.splice(0, this.inbox.length, ...others)
    const last = states.at(-1) ?? (await this.next('room-state'))
    return last.state as Record<string, unknown>
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message))
  }
}

const SITE = 'https://couchwarp.test'

async function connect(path: string, headers: Record<string, string> = {}): Promise<Peer> {
  const response = await exports.default.fetch(`${SITE}${path}`, {
    headers: { Upgrade: 'websocket', ...headers },
  })
  expect(response.status).toBe(101)
  if (!response.webSocket) throw new Error(`no WebSocket on ${path}`)
  return new Peer(response.webSocket)
}

async function openRoom(headers: Record<string, string> = {}) {
  const host = await connect('/api/host', headers)
  const created = await host.next('room-created')
  return { host, code: created.code as string, consoleKey: created.consoleKey as string }
}

function join(code: string, name: string, address = '203.0.113.1'): Promise<Peer> {
  return connect(`/api/rooms/${code}/guest?name=${encodeURIComponent(name)}`, {
    'CF-Connecting-IP': address,
  })
}

async function joined(code: string, name: string, address?: string) {
  const guest = await join(code, name, address)
  const welcome = await guest.next('welcome')
  return { guest, guestId: welcome.guestId as number }
}

async function listed(query = ''): Promise<{ code: string }[]> {
  const response = await exports.default.fetch(`${SITE}/api/rooms${query}`)
  return (await response.json<{ rooms: { code: string }[] }>()).rooms
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const offer = { kind: 'offer', sdp: 'v=0\r\n' }
const answer = { kind: 'answer', sdp: 'v=0\r\n' }
const publicSettings = {
  ...DEFAULT_SETTINGS,
  title: 'Soirée',
  game: 'Overcooked 2',
  visibility: 'public',
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM rooms; DELETE FROM moderation_log;')
})

describe('room codes', () => {
  it('draws six characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomRoomCode()
      expect(isRoomCode(code)).toBe(true)
      expect(code).not.toMatch(/[01ILO]/)
    }
  })

  it('reads lowercase, spaces and dashes', () => {
    expect(normalizeRoomCode(' k7m-2qx ')).toBe('K7M2QX')
    expect(isRoomCode('K7M2Q')).toBe(false)
    expect(isRoomCode('K7M2Q0')).toBe(false)
  })
})

describe('guest names', () => {
  it('trims and collapses spaces, line breaks included', () => {
    expect(cleanGuestName('  Léa   la\nreine ')).toBe('Léa la reine')
  })

  it('refuses empty and overlong names', () => {
    expect(cleanGuestName('   ')).toBeNull()
    expect(cleanGuestName('\u0000\u0007')).toBeNull()
    expect(cleanGuestName('a'.repeat(25))).toBeNull()
    expect(cleanGuestName('🎮'.repeat(24))).toBe('🎮'.repeat(24))
  })
})

describe('a room', () => {
  it('relays the negotiation between a guest and the host', async () => {
    const { host, code } = await openRoom()
    const info = await exports.default.fetch(`${SITE}/api/rooms/${code}`)
    expect(await info.json()).toEqual({ open: true })

    const guest = await join(code.toLowerCase(), 'Léa')
    const welcome = await guest.next('welcome')
    expect(welcome).toMatchObject({
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
      relayOnly: false,
    })
    expect(await host.next('guest-joined')).toEqual({
      type: 'guest-joined',
      guestId: welcome.guestId,
      name: 'Léa',
    })

    guest.send({ type: 'signal', payload: offer })
    expect(await host.next('signal')).toEqual({
      type: 'signal',
      from: welcome.guestId,
      payload: offer,
    })
    host.send({ type: 'signal', to: welcome.guestId, payload: answer })
    expect(await guest.next('signal')).toEqual({ type: 'signal', payload: answer })

    guest.socket.close(1000)
    expect(await host.next('guest-left')).toEqual({ type: 'guest-left', guestId: welcome.guestId })
  })

  it('sends the room state to everyone, guests seated as players', async () => {
    const { host, code } = await openRoom()
    const { guest } = await joined(code, 'Léa')
    expect(await guest.latestState()).toMatchObject({
      code,
      hostName: '',
      members: [{ name: 'Léa', role: 'player', keyboard: false }],
    })
    expect((await host.latestState()).members).toHaveLength(1)
  })

  it('tells guests when the host leaves', async () => {
    const { host, code } = await openRoom()
    const { guest } = await joined(code, 'Sam')
    host.socket.close(1000)
    expect(await guest.next('host-left')).toEqual({ type: 'host-left' })
  })

  it('never reuses a guest id', async () => {
    const { code } = await openRoom()
    const first = await joined(code, 'Ana')
    first.guest.socket.close(1000)
    const second = await joined(code, 'Ana')
    expect(second.guestId).toBeGreaterThan(first.guestId)
  })

  it('turns away the guest after the last place', async () => {
    const { code } = await openRoom()
    for (let i = 0; i < MAX_MEMBERS; i++) await joined(code, `Player ${i + 1}`)
    const late = await join(code, 'Late')
    expect(await late.next('rejected')).toEqual({ type: 'rejected', reason: 'room-full' })
  })

  it('explains a code that matches no room', async () => {
    const guest = await join('ZZZZZZ', 'Léa')
    expect(await guest.next('rejected')).toEqual({ type: 'rejected', reason: 'room-not-found' })
  })

  it('refuses a blank name', async () => {
    const { code } = await openRoom()
    const guest = await join(code, '   ')
    expect(await guest.next('rejected')).toEqual({ type: 'rejected', reason: 'invalid-name' })
  })

  it('closes the socket of a peer that sends garbage', async () => {
    const { code } = await openRoom()
    const { guest } = await joined(code, 'Léa')
    guest.send({ type: 'signal', payload: { kind: 'video', data: 'x' } })
    await expect.poll(() => guest.closeCode).toBe(1008)
  })

  it('asks for a WebSocket upgrade', async () => {
    const response = await exports.default.fetch(`${SITE}/api/host`)
    expect(response.status).toBe(426)
  })
})

describe('managing a room', () => {
  it('kicks a guest, and a ban keeps them out under another name', async () => {
    const { host, code } = await openRoom()
    const { guest, guestId } = await joined(code, 'Troll', '198.51.100.7')
    host.send({ type: 'kick', guestId, ban: true })
    expect(await guest.next('rejected')).toEqual({ type: 'rejected', reason: 'banned' })
    expect(await host.next('guest-left')).toMatchObject({ guestId })

    const again = await join(code, 'Gentil', '198.51.100.7')
    expect(await again.next('rejected')).toEqual({ type: 'rejected', reason: 'banned' })
    const log = await env.DB.prepare('SELECT action, target_name FROM moderation_log').all()
    expect(log.results).toEqual([{ action: 'ban', target_name: 'Troll' }])
  })

  it('shares chat with everyone in the room', async () => {
    const { host, code } = await openRoom()
    const { guest, guestId } = await joined(code, 'Léa')
    guest.send({ type: 'chat', text: 'On lance ?' })
    expect(await host.next('chat')).toMatchObject({
      message: { from: guestId, name: 'Léa', text: 'On lance ?' },
    })
    expect(await guest.next('chat')).toMatchObject({ message: { text: 'On lance ?' } })
  })

  it('opens the console with the key, and refuses a wrong one', async () => {
    const { code, consoleKey } = await openRoom()
    const intruder = await connect(`/api/rooms/${code}/console`)
    intruder.send({ type: 'auth', key: 'wrong-key' })
    expect(await intruder.next('rejected')).toEqual({
      type: 'rejected',
      reason: 'console-key-invalid',
    })

    const { guest, guestId } = await joined(code, 'Léa')
    const remote = await connect(`/api/rooms/${code}/console`)
    remote.send({ type: 'auth', key: consoleKey })
    expect((await remote.latestState()).code).toBe(code)
    remote.send({ type: 'set-role', guestId, role: 'spectator' })
    await expect
      .poll(async () => {
        const state = await guest.latestState()
        return (state.members as { role: string }[])[0]?.role
      })
      .toBe('spectator')
  })

  it('closes the room for everyone', async () => {
    const { host, code } = await openRoom()
    const { guest } = await joined(code, 'Léa')
    host.send({ type: 'close' })
    expect(await guest.next('host-left')).toEqual({ type: 'host-left' })
    const info = await exports.default.fetch(`${SITE}/api/rooms/${code}`)
    expect(await info.json()).toEqual({ open: false })
  })
})

describe('the public list', () => {
  it('keeps the room of a host without an account out of the list', async () => {
    const { host } = await openRoom()
    host.send({ type: 'configure', settings: publicSettings })
    expect((await host.latestState()).publicRefused).toBe('sign-in-required')
    expect(await listed()).toEqual([])
  })

  it('lists a signed-in host’s public room, filtered by game and free seats', async () => {
    const now = Date.now()
    await env.DB.batch([
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind('host-1'),
      env.DB.prepare(
        'INSERT INTO users (id, display_name, age_confirmed_at, created_at) VALUES (?, ?, ?, ?)',
      ).bind('host-1', 'Kiyo', now, now),
      env.DB.prepare(
        'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(await sha256('host-token'), 'host-1', 'host', now, now + 60_000),
    ])
    const { host, code } = await openRoom({ Authorization: 'Bearer host-token' })
    host.send({ type: 'configure', settings: publicSettings })
    await expect
      .poll(async () => (await listed('?game=overcooked&free=1')).map((room) => room.code))
      .toEqual([code])
    expect(await listed('?game=smash')).toEqual([])
  })

  it('serves the thumbnail the host sends', async () => {
    const { host, code } = await openRoom()
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    host.socket.send(jpeg)
    const thumbnail = () => exports.default.fetch(`${SITE}/api/rooms/${code}/thumbnail`)
    await expect.poll(async () => (await thumbnail()).status).toBe(200)
    const response = await thumbnail()
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg)
  })
})
