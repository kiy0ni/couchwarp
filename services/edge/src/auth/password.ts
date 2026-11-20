/**
 * Accounts with a login and a password, for people without Discord or Google. The login
 * is an email address or a name; no email is ever sent, so there is no reset by email:
 * people who fear losing their password link Discord or Google too.
 *
 * - `POST /api/auth/password/signup`: `{ login, password, displayName, atLeast13 }`
 * - `POST /api/auth/password/login`: `{ login, password }`
 * - `POST /api/auth/host-token`: a session for the desktop app, from the site's cookie
 * - `POST /api/me/password`: `{ login, password }`, adds a password to an account
 */

import { fromOurPages, json, problem } from '../http'
import { cleanDisplayName } from '../profiles'
import { createSession, currentUser, sessionCookie, type User } from './sessions'
import { createUser } from './users'

/** The most PBKDF2 rounds the Workers runtime allows. */
const ITERATIONS = 100_000
const MIN_PASSWORD = 10
const MAX_PASSWORD = 128
const FAILURES_ALLOWED = 10
const FAILURE_WINDOW_MS = 15 * 60 * 1000

/** Lower case, trimmed; 3 to 64 characters of letters, digits and `.`, `_`, `-`, `+`, `@`. */
export function cleanLogin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const login = raw.trim().toLowerCase()
  return /^[a-z0-9._+@-]{3,64}$/.test(login) ? login : null
}

function cleanPassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return raw.length >= MIN_PASSWORD && raw.length <= MAX_PASSWORD ? raw : null
}

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export async function hashPassword(password: string, saltHex: string, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const salt = Uint8Array.from(saltHex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return hex(bits)
}

/** Compares without stopping at the first difference, so timing tells nothing. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

interface Hashed {
  hash: string
  salt: string
}

async function hashNew(password: string): Promise<Hashed> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { hash: await hashPassword(password, salt, ITERATIONS), salt }
}

function passwordRow(env: Env, userId: string, login: string, hashed: Hashed) {
  return env.DB.prepare(
    `INSERT INTO passwords (user_id, login, hash, salt, iterations, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(userId, login, hashed.hash, hashed.salt, ITERATIONS, Date.now())
}

function identityRow(env: Env, userId: string, login: string) {
  return env.DB.prepare(
    'INSERT INTO identities (provider, provider_user_id, user_id, username, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind('password', login, userId, login, Date.now())
}

async function signedIn(env: Env, userId: string, status = 200): Promise<Response> {
  const session = await createSession(env.DB, userId, 'web')
  return json({ signedIn: true }, status, {
    'Set-Cookie': sessionCookie(session.token, session.maxAgeSeconds),
  })
}

export async function handlePasswords(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const routes = [
    '/api/auth/password/signup',
    '/api/auth/password/login',
    '/api/auth/host-token',
    '/api/me/password',
  ]
  if (!routes.includes(pathname)) return null
  if (request.method !== 'POST') return problem(405, 'method-not-allowed')
  if (!fromOurPages(request, env)) return problem(403, 'cross-site')

  if (pathname === '/api/auth/host-token') {
    const user = await currentUser(request, env.DB)
    if (!user) return problem(401, 'signed-out')
    const session = await createSession(env.DB, user.id, 'host')
    return json({ token: session.token })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const login = cleanLogin(body?.login)
  const password = cleanPassword(body?.password)
  if (!login) return problem(400, 'invalid-login')
  if (!password) return problem(400, 'invalid-password')

  if (pathname === '/api/auth/password/signup') return signUp(env, login, password, body)
  if (pathname === '/api/auth/password/login') return logIn(env, login, password)
  const user = await currentUser(request, env.DB)
  if (!user) return problem(401, 'signed-out')
  return addPassword(env, user, login, password)
}

async function signUp(
  env: Env,
  login: string,
  password: string,
  body: Record<string, unknown> | null,
): Promise<Response> {
  const displayName =
    typeof body?.displayName === 'string' ? cleanDisplayName(body.displayName) : null
  if (!displayName) return problem(400, 'invalid-name')
  // Under 13, no account is kept at all (GDPR).
  if (body?.atLeast13 !== true) return problem(400, 'too-young')
  const taken = await env.DB.prepare('SELECT 1 FROM passwords WHERE login = ?').bind(login).first()
  if (taken) return problem(409, 'login-taken')
  const hashed = await hashNew(password)
  const userId = await createUser(
    env.DB,
    { displayName, avatarUrl: null, ageConfirmedAt: Date.now() },
    (id) => [passwordRow(env, id, login, hashed), identityRow(env, id, login)],
  )
  return signedIn(env, userId, 201)
}

async function logIn(env: Env, login: string, password: string): Promise<Response> {
  const now = Date.now()
  const failures = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM login_failures WHERE login = ? AND at > ?',
  )
    .bind(login, now - FAILURE_WINDOW_MS)
    .first<number>('count')
  if ((failures ?? 0) >= FAILURES_ALLOWED) return problem(429, 'too-many-attempts')

  const row = await env.DB.prepare(
    `SELECT p.user_id, p.hash, p.salt, p.iterations, u.banned_until FROM passwords p
     JOIN users u ON u.id = p.user_id WHERE p.login = ?`,
  )
    .bind(login)
    .first<{
      user_id: string
      hash: string
      salt: string
      iterations: number
      banned_until: number | null
    }>()
  const hash = row ? await hashPassword(password, row.salt, row.iterations) : null
  if (!row || !hash || !sameText(hash, row.hash)) {
    await env.DB.prepare('INSERT INTO login_failures (login, at) VALUES (?, ?)')
      .bind(login, now)
      .run()
    return problem(401, 'wrong-login')
  }
  if (row.banned_until !== null && row.banned_until > now) return problem(403, 'banned')
  return signedIn(env, row.user_id)
}

async function addPassword(
  env: Env,
  user: User,
  login: string,
  password: string,
): Promise<Response> {
  const existing = await env.DB.prepare(
    'SELECT user_id FROM passwords WHERE login = ? OR user_id = ?',
  )
    .bind(login, user.id)
    .first<string>('user_id')
  if (existing) return problem(409, existing === user.id ? 'already-linked' : 'login-taken')
  const hashed = await hashNew(password)
  await env.DB.batch([passwordRow(env, user.id, login, hashed), identityRow(env, user.id, login)])
  return json({ linked: true }, 201)
}
