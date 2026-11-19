import { DEFAULT_SETTINGS } from '@couchwarp/protocol'
import { describe, expect, it } from 'vitest'
import { MAX_MEMBERS, type Policy, RoomModel } from '../src/room-model'

const HOST = { kind: 'host' } as const
const guest = (guestId: number) => ({ kind: 'guest', guestId }) as const
const OPEN: Policy = { publicRoomsEnabled: true, relayAvailable: true }

function room(maxPlayers = 2) {
  const model = RoomModel.create('K7M2QX', { name: 'Kiyo', userId: null })
  model.apply(HOST, { type: 'configure', settings: { ...DEFAULT_SETTINGS, maxPlayers } }, 0)
  return model
}

function roles(model: RoomModel): Record<number, string> {
  return Object.fromEntries(model.state(OPEN).members.map((m) => [m.id, m.role]))
}

describe('joining', () => {
  it('seats players until the room is full, then adds spectators', () => {
    const model = room(2)
    model.join(1, 'Léa', null, ['ip:a'], 1)
    model.join(2, 'Sam', null, ['ip:b'], 2)
    model.join(3, 'Ana', null, ['ip:c'], 3)
    expect(roles(model)).toEqual({ 1: 'player', 2: 'player', 3: 'spectator' })
  })

  it('starts guests with the controller only', () => {
    const model = room()
    const member = model.join(1, 'Léa', null, [], 0)
    expect(member).toMatchObject({ keyboard: false, mouse: false, padType: 'xbox360' })
  })

  it('carries the account name and avatar', () => {
    const model = room()
    const member = model.join(
      1,
      'Léa',
      { userId: 'u1', displayName: 'Léa', avatarUrl: 'a.png' },
      [],
      0,
    )
    expect(member).toMatchObject({ userId: 'u1', avatarUrl: 'a.png' })
  })

  it('turns away banned people and full rooms', () => {
    const model = room()
    model.join(1, 'Léa', null, ['user:u1', 'ip:a'], 0)
    model.apply(HOST, { type: 'kick', guestId: 1, ban: true }, 0)
    model.leave(1, 0)
    expect(model.join(2, 'Léa encore', null, ['ip:a'], 0)).toBe('banned')
    for (let id = 10; id < 10 + MAX_MEMBERS; id++) model.join(id, `G${id}`, null, [], 0)
    expect(model.join(99, 'Late', null, [], 0)).toBe('room-full')
  })

  it('gives a freed seat to the first spectator in line', () => {
    const model = room(1)
    model.join(1, 'Léa', null, [], 0)
    model.join(2, 'Sam', null, [], 0)
    model.join(3, 'Ana', null, [], 0)
    model.raiseHand(3, true)
    model.leave(1, 5)
    expect(roles(model)).toEqual({ 2: 'spectator', 3: 'player' })
  })
})

describe('permissions to act', () => {
  it('lets only the host configure, grant keys or close', () => {
    const model = room()
    model.join(1, 'Léa', null, [], 0)
    model.apply(HOST, { type: 'set-role', guestId: 1, role: 'moderator' }, 0)
    expect(model.apply(guest(1), { type: 'close' }, 0)).toEqual({ ok: false, reason: 'forbidden' })
    expect(
      model.apply(
        guest(1),
        { type: 'set-permissions', guestId: 1, keyboard: true, mouse: true },
        0,
      ),
    ).toEqual({ ok: false, reason: 'forbidden' })
    expect(model.apply(HOST, { type: 'close' }, 0)).toEqual({ ok: true, closed: true })
  })

  it('lets moderators kick players but not other moderators', () => {
    const model = room(3)
    model.join(1, 'Mod', null, [], 0)
    model.join(2, 'Mod 2', null, [], 0)
    model.join(3, 'Troll', null, [], 0)
    model.apply(HOST, { type: 'set-role', guestId: 1, role: 'moderator' }, 0)
    model.apply(HOST, { type: 'set-role', guestId: 2, role: 'moderator' }, 0)
    expect(model.apply(guest(1), { type: 'kick', guestId: 3, ban: false }, 0)).toEqual({
      ok: true,
      kicked: 3,
    })
    expect(model.apply(guest(1), { type: 'kick', guestId: 2, ban: false }, 0).ok).toBe(false)
    expect(model.apply(guest(1), { type: 'set-role', guestId: 3, role: 'moderator' }, 0).ok).toBe(
      false,
    )
  })

  it('lets players pick their own controller type only', () => {
    const model = room()
    model.join(1, 'Léa', null, [], 0)
    model.join(2, 'Sam', null, [], 0)
    expect(
      model.apply(guest(1), { type: 'set-pad-type', guestId: 1, padType: 'dualshock4' }, 0).ok,
    ).toBe(true)
    expect(
      model.apply(guest(1), { type: 'set-pad-type', guestId: 2, padType: 'dualshock4' }, 0).ok,
    ).toBe(false)
  })

  it('refuses to seat a spectator when no seat is free', () => {
    const model = room(1)
    model.join(1, 'Léa', null, [], 0)
    model.join(2, 'Sam', null, [], 0)
    expect(model.apply(HOST, { type: 'set-role', guestId: 2, role: 'player' }, 0)).toEqual({
      ok: false,
      reason: 'not-allowed',
    })
  })
})

describe('seats', () => {
  it('keeps a player moved to spectator watching, and seats another', () => {
    const model = room(1)
    model.join(1, 'Léa', null, [], 0)
    model.join(2, 'Sam', null, [], 0)
    model.apply(HOST, { type: 'set-role', guestId: 1, role: 'spectator' }, 1)
    expect(roles(model)).toEqual({ 1: 'spectator', 2: 'player' })
  })
})

describe('settings', () => {
  it('moves the latest players to spectators when seats shrink', () => {
    const model = room(3)
    model.join(1, 'Léa', null, [], 1)
    model.join(2, 'Sam', null, [], 2)
    model.join(3, 'Ana', null, [], 3)
    model.apply(HOST, { type: 'configure', settings: { ...DEFAULT_SETTINGS, maxPlayers: 1 } }, 4)
    expect(roles(model)).toEqual({ 1: 'player', 2: 'spectator', 3: 'spectator' })
  })

  it('keeps a room private unless a signed-in host may list it', () => {
    const anonymous = room()
    anonymous.apply(
      HOST,
      { type: 'configure', settings: { ...DEFAULT_SETTINGS, visibility: 'public' } },
      0,
    )
    expect(anonymous.state(OPEN).publicRefused).toBe('sign-in-required')
    expect(anonymous.effectiveVisibility(OPEN)).toBe('link')

    const signedIn = RoomModel.create('ABCDEF', { name: 'Kiyo', userId: 'u1' })
    signedIn.apply(
      HOST,
      { type: 'configure', settings: { ...DEFAULT_SETTINGS, visibility: 'public' } },
      0,
    )
    expect(signedIn.effectiveVisibility(OPEN)).toBe('public')
    expect(signedIn.state({ ...OPEN, publicRoomsEnabled: false }).publicRefused).toBe('disabled')
  })
})

describe('hotseat', () => {
  it('hands the longest-playing seat to the first in line', () => {
    const model = room(2)
    model.join(1, 'Léa', null, [], 1)
    model.join(2, 'Sam', null, [], 2)
    model.join(3, 'Ana', null, [], 3)
    model.raiseHand(3, true)
    model.nextTurn(10)
    expect(roles(model)).toEqual({ 1: 'spectator', 2: 'player', 3: 'player' })
    expect(model.state(OPEN).queue).toEqual([1])
  })

  it('sets the end of the turn with the timer', () => {
    const model = room(2)
    model.apply(
      HOST,
      {
        type: 'configure',
        settings: { ...DEFAULT_SETTINGS, hotseat: { mode: 'timer', minutes: 3 } },
      },
      1000,
    )
    expect(model.turnEndsAt).toBe(1000 + 180_000)
  })

  it('only queues spectators', () => {
    const model = room(1)
    model.join(1, 'Léa', null, [], 0)
    expect(model.raiseHand(1, true)).toEqual({ ok: false, reason: 'not-allowed' })
  })
})

describe('chat', () => {
  it('names the sender and limits the pace', () => {
    const model = room()
    model.join(1, 'Léa', null, [], 0)
    const first = model.apply(guest(1), { type: 'chat', text: 'Salut' }, 5000)
    expect(first).toMatchObject({ ok: true, chat: { from: 1, name: 'Léa', text: 'Salut' } })
    expect(model.apply(guest(1), { type: 'chat', text: 'Encore' }, 5500)).toEqual({
      ok: false,
      reason: 'too-fast',
    })
    expect(model.apply(HOST, { type: 'chat', text: 'Bienvenue' }, 5600)).toMatchObject({
      chat: { from: null, name: 'Kiyo' },
    })
  })

  it('keeps the last 50 messages for people who join later', () => {
    const model = room()
    for (let i = 0; i < 60; i++) model.apply(HOST, { type: 'chat', text: `m${i}` }, i)
    expect(model.chatHistory).toHaveLength(50)
    expect(model.chatHistory[0]?.text).toBe('m10')
  })
})
