import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SITE = 'https://couchwarp.test'

interface DiscordUser {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
}

const lea: DiscordUser = { id: '111', username: 'lea', global_name: 'Léa', avatar: 'abc' }

/** Plays Discord: answers the token exchange and the profile request. */
function discordAnswers(user: DiscordUser) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === 'https://discord.com/api/oauth2/token') {
      return Response.json({ access_token: 'discord-token' })
    }
    if (url === 'https://discord.com/api/users/@me') return Response.json(user)
    throw new Error(`unexpected request to ${url}`)
  })
}

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(`${SITE}${path}`, { redirect: 'manual', ...init })
}

/** Runs a full Discord sign-in and returns the response of the callback. */
async function signIn(user: DiscordUser, query = 'return_to=/compte'): Promise<Response> {
  const start = await call(`/api/auth/discord/start?${query}`)
  expect(start.status).toBe(302)
  const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state')
  discordAnswers(user)
  return call(`/api/auth/discord/callback?code=the-code&state=${state}`)
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.get('Set-Cookie') ?? ''
  return cookie.split(';')[0] ?? ''
}

const ours = (cookie: string, method = 'POST', body?: unknown): RequestInit => ({
  method,
  headers: { Cookie: cookie, Origin: SITE, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeEach(async () => {
  await env.DB.exec('DELETE FROM users; DELETE FROM oauth_states;')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sign-in with Discord', () => {
  it('lists only configured providers', async () => {
    const response = await call('/api/auth/providers')
    expect(await response.json()).toEqual({ providers: ['discord'] })
  })

  it('sends the person to Discord with a state and our callback', async () => {
    const response = await call('/api/auth/discord/start?return_to=/compte')
    const target = new URL(response.headers.get('Location') ?? '')
    expect(target.origin + target.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(target.searchParams.get('client_id')).toBe('discord-client')
    expect(target.searchParams.get('redirect_uri')).toBe(`${SITE}/api/auth/discord/callback`)
    expect(target.searchParams.get('scope')).toBe('identify')
    expect(target.searchParams.get('state')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('creates the account, opens a session and returns to the page', async () => {
    const callback = await signIn(lea)
    expect(callback.status).toBe(302)
    expect(callback.headers.get('Location')).toBe('/compte')
    expect(callback.headers.get('Set-Cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/)

    const me = await call('/api/me', { headers: { Cookie: cookieFrom(callback) } })
    expect(await me.json()).toMatchObject({
      displayName: 'Léa',
      avatarUrl: 'https://cdn.discordapp.com/avatars/111/abc.png?size=128',
      ageConfirmed: false,
      identities: [{ provider: 'discord', username: 'lea' }],
    })
  })

  it('finds the same account on the next sign-in', async () => {
    const first = await (
      await call('/api/me', { headers: { Cookie: cookieFrom(await signIn(lea)) } })
    ).json<{ id: string }>()
    vi.restoreAllMocks()
    const second = await (
      await call('/api/me', { headers: { Cookie: cookieFrom(await signIn(lea)) } })
    ).json<{ id: string }>()
    expect(second.id).toBe(first.id)
  })

  it('refuses a state used twice or unknown', async () => {
    const response = await call('/api/auth/discord/callback?code=x&state=forged')
    expect(response.headers.get('Location')).toBe('/?auth_error=expired')
  })

  it('only returns to this site, or to the host app on this machine', async () => {
    expect((await call('/api/auth/discord/start?return_to=//evil.example')).status).toBe(400)
    expect((await call('/api/auth/discord/start?return_to=https://evil.example')).status).toBe(400)
    expect(
      (await call('/api/auth/discord/start?client=host&return_to=http://evil.example/cb')).status,
    ).toBe(400)
  })

  it('gives the host app a bearer token on its loopback address', async () => {
    const callback = await signIn(lea, 'client=host&return_to=http://127.0.0.1:4567/cb')
    const back = new URL(callback.headers.get('Location') ?? '')
    expect(back.origin + back.pathname).toBe('http://127.0.0.1:4567/cb')
    const token = back.searchParams.get('token')
    const me = await call('/api/me', { headers: { Authorization: `Bearer ${token}` } })
    expect(me.status).toBe(200)
  })

  it('trades the host app token for a cookie in the desktop window', async () => {
    const callback = await signIn(lea, 'client=host&return_to=http://127.0.0.1:4567/cb')
    const token = new URL(callback.headers.get('Location') ?? '').searchParams.get('token')
    expect((await call('/api/auth/app-session', { method: 'POST' })).status).toBe(401)
    const traded = await call('/api/auth/app-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(traded.status).toBe(200)
    const cookie = traded.headers.get('Set-Cookie')?.split(';')[0] ?? ''
    const me = await call('/api/me', { headers: { Cookie: cookie } })
    expect(await me.json()).toMatchObject({ displayName: 'Léa' })
  })

  it('keeps banned people out', async () => {
    const cookie = cookieFrom(await signIn(lea))
    await env.DB.prepare('UPDATE users SET banned_until = ?')
      .bind(Date.now() + 60_000)
      .run()
    expect((await call('/api/me', { headers: { Cookie: cookie } })).status).toBe(401)
    vi.restoreAllMocks()
    const again = await signIn(lea)
    expect(again.headers.get('Location')).toBe('/compte?auth_error=banned')
  })
})

describe('the account', () => {
  it('records the age confirmation', async () => {
    const cookie = cookieFrom(await signIn(lea))
    const response = await call('/api/me/age', ours(cookie, 'POST', { atLeast13: true }))
    expect(await response.json()).toEqual({ ageConfirmed: true })
  })

  it('deletes the account of someone under 13', async () => {
    const cookie = cookieFrom(await signIn(lea))
    await call('/api/me/age', ours(cookie, 'POST', { atLeast13: false }))
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0)
  })

  it('refuses changes posted from another site', async () => {
    const cookie = cookieFrom(await signIn(lea))
    const response = await call('/api/me', {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
  })

  it('exports everything stored about the person', async () => {
    const cookie = cookieFrom(await signIn(lea))
    const response = await call('/api/me/export', { headers: { Cookie: cookie } })
    expect(response.headers.get('Content-Disposition')).toContain('attachment')
    expect(await response.json()).toMatchObject({
      user: { displayName: 'Léa' },
      identities: [{ provider: 'discord' }],
      sessions: [{ kind: 'web' }],
    })
  })

  it('never unlinks the last way to sign in', async () => {
    const cookie = cookieFrom(await signIn(lea))
    const response = await call('/api/me/identities/discord', ours(cookie, 'DELETE'))
    expect(response.status).toBe(409)
  })

  it('deletes the account and its sessions', async () => {
    const cookie = cookieFrom(await signIn(lea))
    expect((await call('/api/me', ours(cookie, 'DELETE'))).status).toBe(200)
    expect((await call('/api/me', { headers: { Cookie: cookie } })).status).toBe(401)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(0)
  })

  it('signs out', async () => {
    const cookie = cookieFrom(await signIn(lea))
    await call('/api/auth/logout', ours(cookie))
    expect((await call('/api/me', { headers: { Cookie: cookie } })).status).toBe(401)
  })
})
