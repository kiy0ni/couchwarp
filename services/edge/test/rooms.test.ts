import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { DEFAULT_SETTINGS, isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanGuestName } from '../src/room'
import { randomRoomCode } from '../src/room-code'
import { MAX_MEMBERS } from '../src/room-model'
import { connect, join, joined, listed, openRoom, SITE, signIn } from './helpers'

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

// Rooms look their game up in the Steam store: here, a store that knows nothing.
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ items: [] }))
})
afterEach(() => vi.restoreAllMocks())

describe('a room', () => {
  it('relays the negotiation between a guest and the host', async () => {
    const { host, code } = await openRoom()
    const info = await exports.default.fetch(`${SITE}/api/rooms/${code}`)
    expect(await info.json()).toMatchObject({
      open: true,
      room: { players: 0, spectators: 0, maxPlayers: expect.any(Number), addressesHidden: false },
    })

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

  it('seats a signed-in guest under their account, and a guest without one too', async () => {
    const { code } = await openRoom()
    const token = await signIn('guest-1', 'Léa')
    const signedIn = await connect(`/api/rooms/${code}/guest?name=Léa`, {
      Authorization: `Bearer ${token}`,
      'CF-Connecting-IP': '203.0.113.9',
    })
    await signedIn.next('welcome')
    const { guest } = await joined(code, 'Sam')
    const members = (await guest.latestState()).members
    expect(members).toEqual([
      expect.objectContaining({ name: 'Léa', userId: 'guest-1', role: 'player' }),
      expect.objectContaining({ name: 'Sam', userId: null, role: 'player' }),
    ])
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

/** A signed-in account for the host; returns its bearer token. */
function signedInHost(): Promise<string> {
  return signIn('host-1', 'Kiyo')
}

describe('the public list', () => {
  it('keeps the room of a host without an account out of the list', async () => {
    const { host } = await openRoom()
    host.send({ type: 'configure', settings: publicSettings })
    expect((await host.latestState()).publicRefused).toBe('sign-in-required')
    expect(await listed()).toEqual([])
  })

  it('lists a signed-in host’s public room, filtered by game and free seats', async () => {
    const { host, code } = await openRoom({ Authorization: `Bearer ${await signedInHost()}` })
    host.send({ type: 'configure', settings: publicSettings })
    await expect
      .poll(async () => (await listed('?game=overcooked&free=1')).map((room) => room.code))
      .toEqual([code])
    expect(await listed('?game=smash')).toEqual([])
  })

  it('shows the picture of a public room only, and only a JPEG', async () => {
    const { host, code } = await openRoom({ Authorization: `Bearer ${await signedInHost()}` })
    const thumbnail = () => exports.default.fetch(`${SITE}/api/rooms/${code}/thumbnail`)
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

    host.socket.send(jpeg)
    host.socket.send(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))
    await host.latestState()
    expect((await thumbnail()).status).toBe(404)

    host.send({ type: 'configure', settings: publicSettings })
    await host.latestState()
    host.socket.send(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))
    host.socket.send(jpeg)
    await expect.poll(async () => (await thumbnail()).status).toBe(200)
    const response = await thumbnail()
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg)
    const [card] = await listed()
    expect(card?.thumbnailUrl).toBe(`/api/rooms/${code}/thumbnail`)

    host.send({ type: 'configure', settings: { ...publicSettings, visibility: 'link' } })
    await expect.poll(async () => (await thumbnail()).status).toBe(404)
  })
})

describe('the door', () => {
  it('keeps a guest waiting, with nothing to connect with, until the host says yes', async () => {
    const { host, code } = await openRoom({}, 'ask')
    const guest = await join(code, 'Noé')
    expect(await guest.next('waiting')).toEqual({ type: 'waiting' })
    const state = await host.latestState()
    expect(state.waiting).toEqual([
      { id: expect.any(Number), name: 'Noé', avatarUrl: null, userId: null },
    ])
    expect(state.members).toEqual([])

    // While waiting, the guest can neither signal the host nor chat, and sees nothing.
    guest.send({ type: 'chat', text: 'Coucou' })
    guest.send({ type: 'signal', payload: { kind: 'offer', sdp: 'v=0' } })
    host.send({ type: 'chat', text: 'Qui est là ?' })
    await host.next('chat')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(guest.received('room-state')).toBe(0)
    expect(guest.received('chat')).toBe(0)

    const id = (state.waiting as { id: number }[])[0]?.id
    host.send({ type: 'admit', guestId: id, accept: true })
    const welcome = await guest.next('welcome')
    expect(welcome.guestId).toBe(id)
    expect(await host.next('guest-joined')).toMatchObject({ guestId: id, name: 'Noé' })
    const after = await host.latestState()
    expect(after.waiting).toEqual([])
    expect(after.members).toEqual([expect.objectContaining({ id, name: 'Noé' })])
  })

  it('turns a guest away when the host says no', async () => {
    const { host, code } = await openRoom({}, 'ask')
    const guest = await join(code, 'Troll')
    await guest.next('waiting')
    const id = ((await host.latestState()).waiting as { id: number }[])[0]?.id
    host.send({ type: 'admit', guestId: id, accept: false })
    expect(await guest.next('rejected')).toEqual({ type: 'rejected', reason: 'refused' })
    expect((await host.latestState()).waiting).toEqual([])
  })

  it('forgets a guest who leaves the door', async () => {
    const { host, code } = await openRoom({}, 'ask')
    const guest = await join(code, 'Pressé')
    await guest.next('waiting')
    guest.socket.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await host.latestState()).waiting).toEqual([])
  })

  it('asks for everyone by default', async () => {
    const host = await connect('/api/host')
    await host.next('room-created')
    const state = await host.next('room-state')
    expect((state.state as { settings: { admission: string } }).settings.admission).toBe('ask')
  })
})
