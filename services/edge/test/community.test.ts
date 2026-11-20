import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { cleanUp } from '../src/cleanup'
import { connect, joined, openRoom, SITE, sha256, signIn } from './helpers'

function api(path: string, token: string | null, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  return exports.default.fetch(`${SITE}${path}`, { ...init, headers })
}

function post(path: string, token: string | null, body: unknown, address = '198.51.100.7') {
  return api(path, token, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'CF-Connecting-IP': address },
  })
}

async function reportsOf(token: string, state = 'open') {
  const response = await api(`/api/admin/reports?state=${state}`, token)
  return (await response.json<{ reports: Record<string, unknown>[] }>()).reports
}

describe('reports', () => {
  it('records who was reported, from inside the room', async () => {
    const { code } = await openRoom()
    const { guestId } = await joined(code, 'Troll')
    const response = await post(
      `/api/rooms/${code}/report`,
      null,
      {
        guestId,
        reason: 'harassment',
        details: 'Insulte tout le monde',
      },
      '198.51.100.20',
    )
    expect(response.status).toBe(201)

    const admin = await signIn('admin-1', 'Modo')
    const reports = await reportsOf(admin)
    expect(reports.find((r) => r.roomCode === code)).toMatchObject({
      targetName: 'Troll',
      reason: 'harassment',
      details: 'Insulte tout le monde',
    })
  })

  it('refuses unknown guests, closed rooms and too many reports from one place', async () => {
    const { code } = await openRoom()
    const unknown = await post(`/api/rooms/${code}/report`, null, {
      guestId: 99,
      reason: 'other',
      details: '',
    })
    expect(unknown.status).toBe(404)
    expect(
      (
        await post('/api/rooms/ZZZZZZ/report', null, {
          guestId: null,
          reason: 'other',
          details: '',
        })
      ).status,
    ).toBe(404)

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const sent = await post(
        `/api/rooms/${code}/report`,
        null,
        { guestId: null, reason: 'other', details: `${i}` },
        '198.51.100.99',
      )
      statuses.push(sent.status)
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
  })

  it('lets only admins decide, always with a reason', async () => {
    const { host, code } = await openRoom()
    const target = await signIn('troll-1', 'Troll')
    const guest = await connect(`/api/rooms/${code}/guest?name=Troll`, {
      Authorization: `Bearer ${target}`,
    })
    const guestId = (await guest.next('welcome')).guestId as number
    await post(
      `/api/rooms/${code}/report`,
      null,
      {
        guestId,
        reason: 'hate',
        details: '',
      },
      '198.51.100.30',
    )

    const someone = await signIn('someone-1', 'Léa')
    expect((await api('/api/admin/reports', someone)).status).toBe(403)

    const admin = await signIn('admin-1', 'Modo')
    const [pending] = (await reportsOf(admin)).filter((r) => r.roomCode === code)
    const decide = (body: unknown) => post(`/api/admin/reports/${pending?.id}`, admin, body)
    expect((await decide({ decision: 'account-suspended', note: '' })).status).toBe(400)
    const decided = await decide({
      decision: 'account-suspended',
      note: 'Propos haineux répétés dans le chat',
      suspendDays: 7,
    })
    expect(decided.status).toBe(200)

    const banned = await env.DB.prepare('SELECT banned_until FROM users WHERE id = ?')
      .bind('troll-1')
      .first<number>('banned_until')
    expect(banned).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000)
    expect((await api('/api/me', target)).status).toBe(401)
    expect((await decide({ decision: 'dismissed', note: 'encore' })).status).toBe(409)

    const closed = await post(
      `/api/rooms/${code}/report`,
      null,
      {
        guestId: null,
        reason: 'illegal-game',
        details: 'Jeu piraté',
      },
      '198.51.100.31',
    )
    expect(closed.status).toBe(201)
    const [roomReport] = (await reportsOf(admin)).filter((r) => r.roomCode === code)
    await post(`/api/admin/reports/${roomReport?.id}`, admin, {
      decision: 'room-closed',
      note: 'Copie piratée',
    })
    await host.next('room-state')
    const info = await api(`/api/rooms/${code}`, null)
    expect(await info.json()).toEqual({ open: false })
  })
})

describe('friends', () => {
  it('needs a game played together, then shows presence', async () => {
    const lea = await signIn('lea-1', 'Léa')
    const sam = await signIn('sam-1', 'Sam')
    const stranger = await signIn('ana-1', 'Ana')

    const { code } = await openRoom({ Authorization: `Bearer ${lea}` })
    const guest = await connect(`/api/rooms/${code}/guest?name=Sam`, {
      Authorization: `Bearer ${sam}`,
    })
    await guest.next('welcome')

    expect((await post('/api/friends', stranger, { userId: 'lea-1' })).status).toBe(403)
    expect((await post('/api/friends', sam, { userId: 'lea-1' })).status).toBe(200)
    const asked = await (await api('/api/friends', lea)).json<{ incoming: { userId: string }[] }>()
    expect(asked.incoming.map((person) => person.userId)).toEqual(['sam-1'])

    const accepted = await post('/api/friends', lea, { userId: 'sam-1' })
    const list = await accepted.json<{
      friends: { userId: string; presence: { hosting: boolean; roomCode: string | null } | null }[]
    }>()
    // Sam is in Léa's game; it is not public, so the code stays private.
    expect(list.friends).toEqual([
      expect.objectContaining({
        userId: 'sam-1',
        presence: expect.objectContaining({ roomCode: null }),
      }),
    ])
    const fromSam = await (await api('/api/friends', sam)).json<typeof list>()
    expect(fromSam.friends[0]?.presence?.hosting).toBe(true)

    await api('/api/friends/sam-1', lea, { method: 'DELETE' })
    const after = await (await api('/api/friends', sam)).json<typeof list>()
    expect(after.friends).toEqual([])
  })
  it('gives a friend the keyboard and mouse the host chose, from the start', async () => {
    const lea = await signIn('lea-2', 'Léa')
    const sam = await signIn('sam-2', 'Sam')
    const first = await openRoom({ Authorization: `Bearer ${lea}` })
    const visit = await connect(`/api/rooms/${first.code}/guest?name=Sam`, {
      Authorization: `Bearer ${sam}`,
    })
    await visit.next('welcome')
    await post('/api/friends', sam, { userId: 'lea-2' })
    await post('/api/friends', lea, { userId: 'sam-2' })

    const put = (token: string, friend: string, body: unknown) =>
      api(`/api/friends/${friend}/permissions`, token, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    expect((await put(lea, 'sam-2', { keyboard: 'yes' })).status).toBe(400)
    expect((await put(lea, 'nobody', { keyboard: true, mouse: false })).status).toBe(404)
    const saved = await put(lea, 'sam-2', { keyboard: true, mouse: false })
    const list = await saved.json<{ friends: { permissions: unknown }[] }>()
    expect(list.friends[0]?.permissions).toEqual({ keyboard: true, mouse: false })

    const { host, code } = await openRoom({ Authorization: `Bearer ${lea}` })
    const guest = await connect(`/api/rooms/${code}/guest?name=Sam`, {
      Authorization: `Bearer ${sam}`,
    })
    await guest.next('welcome')
    const state = await host.latestState()
    expect(state.members).toEqual([expect.objectContaining({ keyboard: true, mouse: false })])
  })
})

describe('clean-up', () => {
  it('drops expired sessions and old history, keeps the rest', async () => {
    const now = Date.now()
    const year = 365 * 24 * 3600 * 1000
    await signIn('old-1', 'Old')
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(await sha256('expired'), 'old-1', 'web', now - 2 * year, now - 1000),
      env.DB.prepare(
        'INSERT INTO play_history (user_id, room_code, title, game, host_name, joined_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind('old-1', 'AAAAAA', 'Vieille', '', 'X', now - 2 * year),
      env.DB.prepare(
        'INSERT INTO play_history (user_id, room_code, title, game, host_name, joined_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind('old-1', 'BBBBBB', 'Récente', '', 'X', now - 1000),
    ])
    await cleanUp(env.DB, now)
    const sessions = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
      .bind('old-1')
      .first<number>('n')
    const titles = await env.DB.prepare('SELECT title FROM play_history WHERE user_id = ?')
      .bind('old-1')
      .all<{ title: string }>()
    expect(sessions).toBe(1)
    expect(titles.results.map((row) => row.title)).toEqual(['Récente'])
  })
})
