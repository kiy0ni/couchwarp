/**
 * Accounts with an e-mail address and a password, for people without Discord or Google,
 * and everything around them: confirming the address, a forgotten password, changing the
 * password or the address. Links go by e-mail (`mail.ts`) and work once.
 *
 * - `POST /api/auth/password/signup`: `{ email, password, displayName, atLeast13, lang }`
 * - `POST /api/auth/password/login`: `{ login, password }`, the address or an older login name
 * - `POST /api/auth/password/forgot`: `{ email, lang }`, always answers the same
 * - `POST /api/auth/password/reset`: `{ token, password }`, signs in on every device anew
 * - `POST /api/auth/email/confirm`: `{ token }`, from a confirmation link
 * - `POST /api/auth/host-token`: a session for the desktop app, from the site's cookie
 * - `POST /api/me/password`: `{ email, password, lang }`, adds a password to an account
 * - `POST /api/me/password/change`: `{ current, password, lang }`
 * - `POST /api/me/email`: `{ email, password, lang }`, sends a link to the new address
 * - `POST /api/me/email/resend`: `{ lang }`, the confirmation link again
 */

import { fromOurPages, json, problem, siteOrigin } from '../http'
import { type MailKind, type MailLanguage, mailLanguage, sendMail } from '../mail'
import { cleanDisplayName } from '../profiles'
import { allow, networkBucket } from '../rate'
import {
  createSession,
  currentUser,
  hashToken,
  randomToken,
  requestToken,
  sessionCookie,
  type User,
} from './sessions'
import { createUser } from './users'

/** The most PBKDF2 rounds the Workers runtime allows. */
const ITERATIONS = 100_000
const MIN_PASSWORD = 10
const MAX_PASSWORD = 128
const FAILURES_ALLOWED = 10
const FAILURE_WINDOW_MS = 15 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
/** How long each kind of link works. */
const LINK_LIFETIME_MS: Record<'verify' | 'change' | 'reset', number> = {
  verify: 48 * HOUR_MS,
  change: 24 * HOUR_MS,
  reset: HOUR_MS,
}
/** Hashed when no account matches, so an unknown login takes as long as a known one. */
const DECOY_SALT = '00000000000000000000000000000000'

type LinkPurpose = keyof typeof LINK_LIFETIME_MS

/** Lower case and trimmed; a plain address of at most 254 characters. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@"<>()[\],;:]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)
    ? email
    : null
}

/**
 * What people sign in with: their address, or, for accounts made before addresses,
 * a name of 3 to 64 letters, digits and `.`, `_`, `-`, `+`, `@`.
 */
export function cleanLogin(raw: unknown): string | null {
  const email = cleanEmail(raw)
  if (email) return email
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

type Body = Record<string, unknown> | null

const ROUTES = new Set([
  '/api/auth/password/signup',
  '/api/auth/password/login',
  '/api/auth/password/forgot',
  '/api/auth/password/reset',
  '/api/auth/email/confirm',
  '/api/auth/host-token',
  '/api/me/password',
  '/api/me/password/change',
  '/api/me/email',
  '/api/me/email/resend',
])

export async function handlePasswords(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!ROUTES.has(pathname)) return null
  if (request.method !== 'POST') return problem(405, 'method-not-allowed')
  if (!fromOurPages(request, env)) return problem(403, 'cross-site')

  if (pathname === '/api/auth/host-token') {
    const user = await currentUser(request, env.DB)
    if (!user) return problem(401, 'signed-out')
    const session = await createSession(env.DB, user.id, 'host')
    return json({ token: session.token })
  }

  const body = (await request.json().catch(() => null)) as Body
  const lang = mailLanguage(body?.lang)
  switch (pathname) {
    case '/api/auth/password/signup':
      return signUp(request, env, body, lang)
    case '/api/auth/password/login':
      return logIn(request, env, body)
    case '/api/auth/password/forgot':
      return forgot(request, env, body, lang)
    case '/api/auth/password/reset':
      return reset(env, body)
    case '/api/auth/email/confirm':
      return confirmEmail(env, body)
  }

  const user = await currentUser(request, env.DB)
  if (!user) return problem(401, 'signed-out')
  switch (pathname) {
    case '/api/me/password':
      return addPassword(request, env, user, body, lang)
    case '/api/me/password/change':
      return changePassword(request, env, user, body, lang)
    case '/api/me/email':
      return changeEmail(request, env, user, body, lang)
    default:
      return resendConfirmation(request, env, user, lang)
  }
}

async function signUp(request: Request, env: Env, body: Body, lang: MailLanguage) {
  const email = cleanEmail(body?.email)
  const password = cleanPassword(body?.password)
  const displayName =
    typeof body?.displayName === 'string' ? cleanDisplayName(body.displayName) : null
  if (!email) return problem(400, 'invalid-email')
  if (!password) return problem(400, 'invalid-password')
  if (!displayName) return problem(400, 'invalid-name')
  // Under 13, no account is kept at all (GDPR).
  if (body?.atLeast13 !== true) return problem(400, 'too-young')
  if (!(await allow(env.DB, await networkBucket(request, 'signup'), 5, HOUR_MS))) {
    return problem(429, 'too-many-attempts')
  }
  const taken = await env.DB.prepare(
    'SELECT 1 FROM passwords WHERE login = ? UNION SELECT 1 FROM users WHERE email = ?',
  )
    .bind(email, email)
    .first()
  if (taken) return problem(409, 'email-taken')
  const hashed = await hashNew(password)
  const userId = await createUser(
    env.DB,
    { displayName, avatarUrl: null, ageConfirmedAt: Date.now(), email },
    (id) => [passwordRow(env, id, email, hashed), identityRow(env, id, email)],
  )
  await sendLinkQuietly(request, env, userId, 'verify', email, lang)
  return signedIn(env, userId, 201)
}

async function logIn(request: Request, env: Env, body: Body): Promise<Response> {
  const login = cleanLogin(body?.login)
  const password = cleanPassword(body?.password)
  if (!login || !password) return problem(401, 'wrong-login')
  const now = Date.now()
  const failures = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM login_failures WHERE login = ? AND at > ?',
  )
    .bind(login, now - FAILURE_WINDOW_MS)
    .first<number>('count')
  const network = await networkBucket(request, 'login')
  // One network trying many logins is slowed down as well as one login tried many times.
  if (
    (failures ?? 0) >= FAILURES_ALLOWED ||
    !(await allow(env.DB, network, 60, FAILURE_WINDOW_MS, now))
  ) {
    return problem(429, 'too-many-attempts')
  }

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
  const hash = await hashPassword(password, row?.salt ?? DECOY_SALT, row?.iterations ?? ITERATIONS)
  if (!row || !sameText(hash, row.hash)) {
    await env.DB.prepare('INSERT INTO login_failures (login, at) VALUES (?, ?)')
      .bind(login, now)
      .run()
    return problem(401, 'wrong-login')
  }
  if (row.banned_until !== null && row.banned_until > now) return problem(403, 'banned')
  return signedIn(env, row.user_id)
}

/**
 * Sends a reset link when an account has this address. The answer never says whether
 * one does, so the form cannot be used to find out who has an account.
 */
async function forgot(request: Request, env: Env, body: Body, lang: MailLanguage) {
  const email = cleanEmail(body?.email)
  if (!email) return problem(400, 'invalid-email')
  const allowed =
    (await allow(env.DB, await networkBucket(request, 'forgot'), 5, HOUR_MS)) &&
    (await allow(env.DB, `forgot:${await hashToken(email)}`, 3, HOUR_MS))
  if (!allowed) return problem(429, 'too-many-attempts')
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<string>('id')
  if (user) await sendLinkQuietly(request, env, user, 'reset', email, lang)
  return json({ sent: true }, 202)
}

async function reset(env: Env, body: Body): Promise<Response> {
  const password = cleanPassword(body?.password)
  if (!password) return problem(400, 'invalid-password')
  const link = await useLink(env, body?.token, ['reset'])
  if (!link) return problem(400, 'link-expired')
  const hashed = await hashNew(password)
  const login = await env.DB.prepare('SELECT login FROM passwords WHERE user_id = ?')
    .bind(link.user_id)
    .first<string>('login')
  const now = Date.now()
  await env.DB.batch([
    login === null
      ? passwordRow(env, link.user_id, link.email, hashed)
      : env.DB.prepare(
          'UPDATE passwords SET hash = ?, salt = ?, iterations = ? WHERE user_id = ?',
        ).bind(hashed.hash, hashed.salt, ITERATIONS, link.user_id),
    ...(login === null ? [identityRow(env, link.user_id, link.email)] : []),
    // The link reached this address: it is confirmed too.
    env.DB.prepare(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? AND email = ?',
    ).bind(now, link.user_id, link.email),
    // Whoever knew the old password is signed out everywhere.
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(link.user_id),
    env.DB.prepare('DELETE FROM login_failures WHERE login = ?').bind(login ?? link.email),
  ])
  return signedIn(env, link.user_id)
}

async function confirmEmail(env: Env, body: Body): Promise<Response> {
  const link = await useLink(env, body?.token, ['verify', 'change'])
  if (!link) return problem(400, 'link-expired')
  const now = Date.now()
  if (link.purpose === 'verify') {
    await env.DB.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email = ?')
      .bind(now, link.user_id, link.email)
      .run()
    return json({ confirmed: link.email })
  }
  const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .bind(link.email, link.user_id)
    .first()
  if (taken) return problem(409, 'email-taken')
  const previous = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(link.user_id)
    .first<string | null>('email')
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?').bind(
      link.email,
      now,
      link.user_id,
    ),
    // An address used as the login moves with it; an older login name stays.
    env.DB.prepare('UPDATE passwords SET login = ? WHERE user_id = ? AND login = ?').bind(
      link.email,
      link.user_id,
      previous ?? '',
    ),
    env.DB.prepare(
      "UPDATE identities SET provider_user_id = ?, username = ? WHERE user_id = ? AND provider = 'password' AND provider_user_id = ?",
    ).bind(link.email, link.email, link.user_id, previous ?? ''),
  ])
  if (previous) await warn(env, previous, 'email-changed', mailLanguage(body?.lang))
  return json({ confirmed: link.email })
}

/** Adds an address and a password to an account made with Discord or Google. */
async function addPassword(request: Request, env: Env, user: User, body: Body, lang: MailLanguage) {
  const password = cleanPassword(body?.password)
  if (!password) return problem(400, 'invalid-password')
  const email = user.email ?? cleanEmail(body?.email)
  if (!email) return problem(400, 'invalid-email')
  const existing = await env.DB.prepare(
    'SELECT user_id FROM passwords WHERE login = ? OR user_id = ?',
  )
    .bind(email, user.id)
    .first<string>('user_id')
  if (existing) return problem(409, existing === user.id ? 'already-linked' : 'email-taken')
  const owner = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<string>('id')
  if (owner && owner !== user.id) return problem(409, 'email-taken')
  const hashed = await hashNew(password)
  await env.DB.batch([
    passwordRow(env, user.id, email, hashed),
    identityRow(env, user.id, email),
    env.DB.prepare('UPDATE users SET email = ? WHERE id = ? AND email IS NULL').bind(
      email,
      user.id,
    ),
  ])
  if (!user.email) await sendLinkQuietly(request, env, user.id, 'verify', email, lang)
  return json({ linked: true }, 201)
}

/** Needs the current password; every other device is signed out. */
async function changePassword(
  request: Request,
  env: Env,
  user: User,
  body: Body,
  lang: MailLanguage,
) {
  const next = cleanPassword(body?.password)
  if (!next) return problem(400, 'invalid-password')
  if (!(await passwordMatches(request, env, user.id, body?.current))) {
    return problem(403, 'wrong-password')
  }
  const hashed = await hashNew(next)
  const token = requestToken(request)
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE passwords SET hash = ?, salt = ?, iterations = ? WHERE user_id = ?',
    ).bind(hashed.hash, hashed.salt, ITERATIONS, user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(
      user.id,
      token ? await hashToken(token) : '',
    ),
  ])
  if (user.email) await warn(env, user.email, 'password-changed', lang)
  return json({ changed: true })
}

/** The new address is used once confirmed from the link sent to it. */
async function changeEmail(request: Request, env: Env, user: User, body: Body, lang: MailLanguage) {
  const email = cleanEmail(body?.email)
  if (!email) return problem(400, 'invalid-email')
  if (email === user.email) return problem(409, 'same-email')
  const hasPassword = await env.DB.prepare('SELECT 1 FROM passwords WHERE user_id = ?')
    .bind(user.id)
    .first()
  // Someone at an unlocked computer must not take the account away with its address.
  if (hasPassword && !(await passwordMatches(request, env, user.id, body?.password))) {
    return problem(403, 'wrong-password')
  }
  const taken = await env.DB.prepare(
    'SELECT 1 FROM users WHERE email = ? UNION SELECT 1 FROM passwords WHERE login = ?',
  )
    .bind(email, email)
    .first()
  if (taken) return problem(409, 'email-taken')
  if (!(await allow(env.DB, `email:${user.id}`, 5, HOUR_MS))) {
    return problem(429, 'too-many-attempts')
  }
  // An account without an address yet takes this one at once, unconfirmed.
  if (!user.email) {
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, user.id).run()
    await sendLink(request, env, user.id, 'verify', email, lang)
  } else {
    await sendLink(request, env, user.id, 'change', email, lang)
  }
  return json({ sent: true }, 202)
}

async function resendConfirmation(request: Request, env: Env, user: User, lang: MailLanguage) {
  if (!user.email) return problem(409, 'no-email')
  if (user.emailVerified) return problem(409, 'already-confirmed')
  if (!(await allow(env.DB, `resend:${user.id}`, 3, HOUR_MS))) {
    return problem(429, 'too-many-attempts')
  }
  await sendLink(request, env, user.id, 'verify', user.email, lang)
  return json({ sent: true }, 202)
}

async function passwordMatches(
  request: Request,
  env: Env,
  userId: string,
  given: unknown,
): Promise<boolean> {
  if (typeof given !== 'string' || given.length > MAX_PASSWORD) return false
  if (!(await allow(env.DB, await networkBucket(request, 'recheck'), 20, FAILURE_WINDOW_MS))) {
    return false
  }
  const row = await env.DB.prepare('SELECT hash, salt, iterations FROM passwords WHERE user_id = ?')
    .bind(userId)
    .first<{ hash: string; salt: string; iterations: number }>()
  if (!row) return false
  return sameText(await hashPassword(given, row.salt, row.iterations), row.hash)
}

/** Makes a one-time link, keeps only its hash, and mails it. Older links of the same kind stop working. */
async function sendLink(
  request: Request,
  env: Env,
  userId: string,
  purpose: LinkPurpose,
  email: string,
  lang: MailLanguage,
): Promise<void> {
  const token = randomToken()
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?').bind(
      userId,
      purpose,
    ),
    env.DB.prepare(
      'INSERT INTO email_tokens (token_hash, user_id, purpose, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(await hashToken(token), userId, purpose, email, now, now + LINK_LIFETIME_MS[purpose]),
  ])
  // In the fragment: never sent to a server, never in a log or a Referer.
  const page = purpose === 'reset' ? 'reset-password' : 'confirm-email'
  const link = `${siteOrigin(request, env)}/${page}#token=${token}`
  await sendMail(env, email, purpose, lang, link)
}

/**
 * The same, for when the person cannot do anything about a failure now: the account
 * exists anyway, and the link can be asked again.
 */
async function sendLinkQuietly(...args: Parameters<typeof sendLink>): Promise<void> {
  try {
    await sendLink(...args)
  } catch (error) {
    console.error(`E-mail link (${args[3]}) not sent`, error)
  }
}

/** A warning about a change, best effort: the change is done whether it arrives or not. */
async function warn(env: Env, email: string, kind: MailKind, lang: MailLanguage): Promise<void> {
  try {
    await sendMail(env, email, kind, lang)
  } catch (error) {
    console.error(`Warning e-mail (${kind}) not sent`, error)
  }
}

/** Takes a link out of use and returns it, if it exists, is of one of `purposes` and is fresh. */
async function useLink(env: Env, token: unknown, purposes: LinkPurpose[]) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
  const link = await env.DB.prepare('DELETE FROM email_tokens WHERE token_hash = ? RETURNING *')
    .bind(await hashToken(token))
    .first<{ user_id: string; purpose: LinkPurpose; email: string; expires_at: number }>()
  if (!link || !purposes.includes(link.purpose) || link.expires_at < Date.now()) return null
  return link
}
