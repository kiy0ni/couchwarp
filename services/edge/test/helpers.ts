import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { expect } from 'vitest'
import type { RoomCard } from '../src/directory'

type Message = { type: string } & Record<string, unknown>

/** A test-side WebSocket that queues incoming messages until the test asks for them. */
export class Peer {
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

  /** How many messages of this type are queued, unread. */
  received(type: string): number {
    return this.inbox.filter((message) => message.type === type).length
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message))
  }
}

export const SITE = 'https://couchwarp.test'

export async function connect(path: string, headers: Record<string, string> = {}): Promise<Peer> {
  const response = await exports.default.fetch(`${SITE}${path}`, {
    headers: { Upgrade: 'websocket', ...headers },
  })
  expect(response.status).toBe(101)
  if (!response.webSocket) throw new Error(`no WebSocket on ${path}`)
  return new Peer(response.webSocket)
}

/**
 * A room with its host connected. Guests come straight in unless `admission` says
 * otherwise: most tests are not about the door.
 */
export async function openRoom(
  headers: Record<string, string> = {},
  admission: 'ask' | 'friends' | 'open' = 'open',
) {
  const host = await connect('/api/host', headers)
  const created = await host.next('room-created')
  const state = await host.next('room-state')
  const settings = (state.state as { settings: Record<string, unknown> }).settings
  // The state that follows stays queued, as the first one did before, for tests to read.
  host.send({ type: 'configure', settings: { ...settings, admission } })
  return { host, code: created.code as string, consoleKey: created.consoleKey as string }
}

export function join(code: string, name: string, address = '203.0.113.1'): Promise<Peer> {
  return connect(`/api/rooms/${code}/guest?name=${encodeURIComponent(name)}`, {
    'CF-Connecting-IP': address,
  })
}

export async function joined(code: string, name: string, address?: string) {
  const guest = await join(code, name, address)
  const welcome = await guest.next('welcome')
  return { guest, guestId: welcome.guestId as number }
}

export async function listed(query = ''): Promise<RoomCard[]> {
  const response = await exports.default.fetch(`${SITE}/api/rooms${query}`)
  return (await response.json<{ rooms: RoomCard[] }>()).rooms
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Creates (or replaces) an account with a live session; returns its bearer token. */
export async function signIn(userId: string, name: string): Promise<string> {
  const now = Date.now()
  const token = `${userId}-token`
  await env.DB.batch([
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    env.DB.prepare(
      'INSERT INTO users (id, display_name, age_confirmed_at, created_at) VALUES (?, ?, ?, ?)',
    ).bind(userId, name, now, now),
    env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(await sha256(token), userId, 'web', now, now + 60_000),
  ])
  return token
}
