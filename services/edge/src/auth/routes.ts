/**
 * Sign-in with Discord or Google (OAuth 2.0 authorization code flow), and the account
 * routes: who am I, age confirmation, sign out, export, delete, unlink a provider.
 *
 * - `GET  /api/auth/providers`
 * - `GET  /api/auth/:provider/start?client=web|host&return_to=…&link=1`
 * - `GET  /api/auth/:provider/callback`
 * - `POST /api/auth/logout`
 * - `POST /api/auth/app-session`: a browser session for the desktop app's window
 * - `GET  /api/me`, `DELETE /api/me`, `GET /api/me/export`, `POST /api/me/age`
 * - `DELETE /api/me/identities/:provider`
 * - `GET  /api/me/history`
 */

import { friends } from '../friends'
import { fromOurPages, json, problem, redirect, siteOrigin } from '../http'
import { badges } from '../profiles'
import { isAdmin } from '../reports'
import { enabledProviders, exchangeCode, isProviderId, PROVIDERS, type Provider } from './providers'
import {
  CLEARED_COOKIE,
  createSession,
  currentUser,
  deleteSession,
  type SessionKind,
  sessionCookie,
  type User,
} from './sessions'
import { createUser } from './users'

const STATE_LIFETIME_MS = 10 * 60 * 1000

/** Where a sign-in may send the person back: a page of this site, or the host app on loopback. */
function validReturn(client: SessionKind, returnTo: string): boolean {
  if (client === 'web') return returnTo.startsWith('/') && !returnTo.startsWith('//')
  try {
    const url = new URL(returnTo)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  } catch {
    return false
  }
}

function callbackUrl(request: Request, env: Env, provider: Provider): string {
  return `${siteOrigin(request, env)}/api/auth/${provider.id}/callback`
}

/** Back to the web page with an error code the page can explain. */
function failed(returnTo: string, code: string): Response {
  const url = new URL(returnTo, 'https://placeholder.invalid')
  url.searchParams.set('auth_error', code)
  return redirect(url.host === 'placeholder.invalid' ? `${url.pathname}${url.search}` : url.href)
}

async function start(request: Request, env: Env, provider: Provider): Promise<Response> {
  const credentials = provider.credentials(env)
  if (!credentials) return problem(404, 'provider-disabled')
  const params = new URL(request.url).searchParams
  const client: SessionKind = params.get('client') === 'host' ? 'host' : 'web'
  const returnTo = params.get('return_to') ?? '/'
  if (!validReturn(client, returnTo)) return problem(400, 'invalid-return')

  let linkUserId: string | null = null
  if (params.get('link') === '1') {
    const user = await currentUser(request, env.DB)
    if (!user) return problem(401, 'signed-out')
    linkUserId = user.id
  }

  const state = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO oauth_states (state, provider, link_user_id, client, return_to, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(state, provider.id, linkUserId, client, returnTo, Date.now())
    .run()

  const authorize = new URL(provider.authorizeUrl)
  authorize.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: callbackUrl(request, env, provider),
    response_type: 'code',
    scope: provider.scope,
    state,
    prompt: 'consent',
  }).toString()
  return redirect(authorize.href)
}

interface StateRow {
  provider: string
  link_user_id: string | null
  client: SessionKind
  return_to: string
  created_at: number
}

async function callback(request: Request, env: Env, provider: Provider): Promise<Response> {
  const params = new URL(request.url).searchParams
  const state = params.get('state') ?? ''
  const pending = await env.DB.prepare('DELETE FROM oauth_states WHERE state = ? RETURNING *')
    .bind(state)
    .first<StateRow>()
  if (
    !pending ||
    pending.provider !== provider.id ||
    Date.now() - pending.created_at > STATE_LIFETIME_MS
  ) {
    return failed('/', 'expired')
  }
  const code = params.get('code')
  if (!code) return failed(pending.return_to, 'cancelled')

  let userId: string
  try {
    const accessToken = await exchangeCode(provider, env, code, callbackUrl(request, env, provider))
    const profile = await provider.profile(accessToken)
    const outcome = await attachIdentity(env.DB, provider.id, profile, pending.link_user_id)
    if ('error' in outcome) return failed(pending.return_to, outcome.error)
    userId = outcome.userId
  } catch (error) {
    console.error(`Sign-in with ${provider.id} failed`, error)
    return failed(pending.return_to, 'provider-error')
  }

  const banned = await env.DB.prepare('SELECT banned_until FROM users WHERE id = ?')
    .bind(userId)
    .first<number | null>('banned_until')
  if (banned !== null && banned > Date.now()) return failed(pending.return_to, 'banned')

  const session = await createSession(env.DB, userId, pending.client)
  if (pending.client === 'host') {
    const back = new URL(pending.return_to)
    back.searchParams.set('token', session.token)
    return redirect(back.href)
  }
  return redirect(pending.return_to, {
    'Set-Cookie': sessionCookie(session.token, session.maxAgeSeconds),
  })
}

/** Finds or creates the user behind a provider profile, or adds it to `linkUserId`. */
async function attachIdentity(
  db: D1Database,
  provider: string,
  profile: Awaited<ReturnType<Provider['profile']>>,
  linkUserId: string | null,
): Promise<{ userId: string } | { error: string }> {
  const owner = await db
    .prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_user_id = ?')
    .bind(provider, profile.providerUserId)
    .first<string>('user_id')
  const now = Date.now()

  if (linkUserId) {
    if (owner && owner !== linkUserId) return { error: 'identity-in-use' }
    if (!owner) {
      await db
        .prepare(
          'INSERT INTO identities (provider, provider_user_id, user_id, username, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(provider, profile.providerUserId, linkUserId, profile.username, now)
        .run()
    }
    return { userId: linkUserId }
  }
  if (owner) {
    await db
      .prepare('UPDATE identities SET username = ? WHERE provider = ? AND provider_user_id = ?')
      .bind(profile.username, provider, profile.providerUserId)
      .run()
    return { userId: owner }
  }

  const userId = await createUser(
    db,
    { displayName: profile.displayName, avatarUrl: profile.avatarUrl },
    (id) => [
      db
        .prepare(
          'INSERT INTO identities (provider, provider_user_id, user_id, username, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(provider, profile.providerUserId, id, profile.username, now),
    ],
  )
  return { userId }
}

async function identities(db: D1Database, userId: string) {
  const { results } = await db
    .prepare('SELECT provider, username FROM identities WHERE user_id = ? ORDER BY created_at')
    .bind(userId)
    .all<{ provider: string; username: string }>()
  return results
}

async function me(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env.DB)
  if (!user) return problem(401, 'signed-out')
  const extra = await env.DB.prepare('SELECT color, tag, created_at FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ color: string | null; tag: number | null; created_at: number }>()
  return json({
    ...publicUser(user),
    identities: await identities(env.DB, user.id),
    isAdmin: isAdmin(env, user),
    color: extra?.color ?? null,
    tag: extra?.tag ?? null,
    badges: await badges(env, user.id, extra?.created_at ?? Date.now()),
  })
}

function publicUser(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    ageConfirmed: user.ageConfirmed,
  }
}

async function confirmAge(request: Request, env: Env, user: User): Promise<Response> {
  const { atLeast13 } = await request.json<{ atLeast13?: unknown }>()
  if (atLeast13 !== true) {
    // Under 13: no account is kept (GDPR, and the terms of Discord and Google).
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run()
    return json({ deleted: true }, 200, { 'Set-Cookie': CLEARED_COOKIE })
  }
  await env.DB.prepare('UPDATE users SET age_confirmed_at = ? WHERE id = ?')
    .bind(Date.now(), user.id)
    .run()
  return json({ ageConfirmed: true })
}

/** Everything stored about the person, as a downloadable file (GDPR right of access). */
async function exportAccount(env: Env, user: User): Promise<Response> {
  const sessions = await env.DB.prepare(
    'SELECT kind, created_at, expires_at FROM sessions WHERE user_id = ?',
  )
    .bind(user.id)
    .all()
  const body = {
    exportedAt: new Date().toISOString(),
    user: publicUser(user),
    identities: await identities(env.DB, user.id),
    sessions: sessions.results,
    history: await history(env, user.id),
    friends: await friends(env, user),
    reportsSent: (
      await env.DB.prepare(
        'SELECT room_code, reason, details, created_at, decision FROM reports WHERE reporter_user_id = ?',
      )
        .bind(user.id)
        .all()
    ).results,
  }
  return json(body, 200, {
    'Content-Disposition': 'attachment; filename="couchwarp-account.json"',
  })
}

async function history(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT room_code AS roomCode, title, game, host_name AS hostName, joined_at AS joinedAt, left_at AS leftAt
     FROM play_history WHERE user_id = ? ORDER BY joined_at DESC LIMIT 100`,
  )
    .bind(userId)
    .all()
  return results
}

async function unlink(env: Env, user: User, provider: string): Promise<Response> {
  const linked = await identities(env.DB, user.id)
  if (!linked.some((identity) => identity.provider === provider)) return problem(404, 'not-linked')
  if (linked.length === 1) return problem(409, 'last-identity')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').bind(
      user.id,
      provider,
    ),
    // A login without its identity would be a way in no one can see: both go.
    env.DB.prepare('DELETE FROM passwords WHERE user_id = ? AND ? = ?').bind(
      user.id,
      provider,
      'password',
    ),
  ])
  return json({ identities: await identities(env.DB, user.id) })
}

/** Handles `/api/auth/*` and `/api/me*`, or returns null for other paths. */
export async function handleAccounts(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const method = request.method

  if (pathname === '/api/auth/providers') return json({ providers: enabledProviders(env) })

  const flow = pathname.match(/^\/api\/auth\/([a-z]+)\/(start|callback)$/)
  if (flow?.[1] && method === 'GET') {
    if (!isProviderId(flow[1])) return problem(404, 'unknown-provider')
    const provider = PROVIDERS[flow[1]]
    return flow[2] === 'start' ? start(request, env, provider) : callback(request, env, provider)
  }

  if (pathname === '/api/me' && method === 'GET') return me(request, env)
  if (pathname === '/api/auth/app-session' && method === 'POST') return appSession(request, env)
  if (!pathname.startsWith('/api/me') && pathname !== '/api/auth/logout') return null

  if (method !== 'GET' && !fromOurPages(request, env)) return problem(403, 'cross-site')
  if (pathname === '/api/auth/logout' && method === 'POST') {
    await deleteSession(request, env.DB)
    return json({ signedOut: true }, 200, { 'Set-Cookie': CLEARED_COOKIE })
  }

  const user = await currentUser(request, env.DB)
  if (!user) return problem(401, 'signed-out')
  if (pathname === '/api/me' && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run()
    return json({ deleted: true }, 200, { 'Set-Cookie': CLEARED_COOKIE })
  }
  if (pathname === '/api/me/export' && method === 'GET') return exportAccount(env, user)
  if (pathname === '/api/me/history' && method === 'GET')
    return json({ history: await history(env, user.id) })
  if (pathname === '/api/me/age' && method === 'POST') return confirmAge(request, env, user)
  const identity = pathname.match(/^\/api\/me\/identities\/([a-z]+)$/)
  if (identity?.[1] && method === 'DELETE') return unlink(env, user, identity[1])
  return problem(404, 'not-found')
}

/**
 * The desktop app signs in through the system browser, like the host on the command line,
 * and gets a bearer token. Its window shows this site, so it trades that token for the
 * site's own cookie.
 */
async function appSession(request: Request, env: Env): Promise<Response> {
  if (!fromOurPages(request, env)) return problem(403, 'cross-site')
  if (!request.headers.get('Authorization')) return problem(401, 'signed-out')
  const user = await currentUser(request, env.DB)
  if (!user) return problem(401, 'signed-out')
  const session = await createSession(env.DB, user.id, 'web')
  return json({ signedIn: true }, 200, {
    'Set-Cookie': sessionCookie(session.token, session.maxAgeSeconds),
  })
}
