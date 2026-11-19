import { exports } from 'cloudflare:workers'
import { isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { describe, expect, it } from 'vitest'
import { cleanGuestName, MAX_GUESTS } from '../src/room'
import { randomRoomCode } from '../src/room-code'

/** A test-side WebSocket that queues incoming messages until the test asks for them. */
class Peer {
  private readonly inbox: unknown[] = []
  private readonly waiting: ((message: unknown) => void)[] = []
  closeCode: number | null = null

  constructor(readonly socket: WebSocket) {
    socket.accept()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string)
      const waiter = this.waiting.shift()
      if (waiter) waiter(message)
      else this.inbox.push(message)
    })
    socket.addEventListener('close', (event) => {
      this.closeCode = event.code
    })
  }

  next(): Promise<unknown> {
    const queued = this.inbox.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message))
  }
}

async function connect(path: string): Promise<Peer> {
  const response = await exports.default.fetch(`https://couchwarp.test${path}`, {
    headers: { Upgrade: 'websocket' },
  })
  expect(response.status).toBe(101)
  if (!response.webSocket) throw new Error(`no WebSocket on ${path}`)
  return new Peer(response.webSocket)
}

async function openRoom(): Promise<{ host: Peer; code: string }> {
  const host = await connect('/api/host')
  const created = (await host.next()) as { type: string; code: string }
  expect(created.type).toBe('room-created')
  return { host, code: created.code }
}

async function join(code: string, name: string): Promise<Peer> {
  return connect(`/api/rooms/${code}/guest?name=${encodeURIComponent(name)}`)
}

const offer = { kind: 'offer', sdp: 'v=0\r\n' }
const answer = { kind: 'answer', sdp: 'v=0\r\n' }

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
  it('trims and collapses spaces', () => {
    expect(cleanGuestName('  Léa   la   reine ')).toBe('Léa la reine')
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
    const info = await exports.default.fetch(`https://couchwarp.test/api/rooms/${code}`)
    expect(await info.json()).toEqual({ open: true })

    const guest = await join(code.toLowerCase(), 'Léa')
    const welcome = (await guest.next()) as { type: string; guestId: number; iceServers: unknown }
    expect(welcome.type).toBe('welcome')
    expect(welcome.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }])
    expect(await host.next()).toEqual({
      type: 'guest-joined',
      guestId: welcome.guestId,
      name: 'Léa',
    })

    guest.send({ type: 'signal', payload: offer })
    expect(await host.next()).toEqual({ type: 'signal', from: welcome.guestId, payload: offer })

    host.send({ type: 'signal', to: welcome.guestId, payload: answer })
    expect(await guest.next()).toEqual({ type: 'signal', payload: answer })

    guest.socket.close(1000)
    expect(await host.next()).toEqual({ type: 'guest-left', guestId: welcome.guestId })
  })

  it('tells guests when the host leaves', async () => {
    const { host, code } = await openRoom()
    const guest = await join(code, 'Sam')
    await guest.next()
    host.socket.close(1000)
    expect(await guest.next()).toEqual({ type: 'host-left' })
  })

  it('never reuses a guest id', async () => {
    const { code } = await openRoom()
    const first = await join(code, 'Ana')
    const { guestId: firstId } = (await first.next()) as { guestId: number }
    first.socket.close(1000)
    const second = await join(code, 'Ana')
    const { guestId: secondId } = (await second.next()) as { guestId: number }
    expect(secondId).toBeGreaterThan(firstId)
  })

  it('turns away the guest after the last slot', async () => {
    const { code } = await openRoom()
    for (let i = 0; i < MAX_GUESTS; i++) {
      await (await join(code, `Player ${i + 1}`)).next()
    }
    const late = await join(code, 'Late')
    expect(await late.next()).toEqual({ type: 'rejected', reason: 'room-full' })
  })

  it('explains a code that matches no room', async () => {
    const guest = await join('ZZZZZZ', 'Léa')
    expect(await guest.next()).toEqual({ type: 'rejected', reason: 'room-not-found' })
    const info = await exports.default.fetch('https://couchwarp.test/api/rooms/ZZZZZZ')
    expect(await info.json()).toEqual({ open: false })
  })

  it('refuses a blank name', async () => {
    const { code } = await openRoom()
    const guest = await join(code, '   ')
    expect(await guest.next()).toEqual({ type: 'rejected', reason: 'invalid-name' })
  })

  it('closes the socket of a peer that sends garbage', async () => {
    const { code } = await openRoom()
    const guest = await join(code, 'Léa')
    await guest.next()
    guest.send({ type: 'signal', payload: { kind: 'video', data: 'x' } })
    await expect.poll(() => guest.closeCode).toBe(1008)
  })

  it('asks for a WebSocket upgrade', async () => {
    const response = await exports.default.fetch('https://couchwarp.test/api/host')
    expect(response.status).toBe(426)
  })
})
