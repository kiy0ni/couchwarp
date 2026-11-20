/** Session tokens: random, sent once, stored only as a SHA-256 hash. */

import { readCookie } from '../http'

export const SESSION_COOKIE = 'cw_session'
const DAY_MS = 24 * 60 * 60 * 1000
const LIFETIME_MS = { web: 30 * DAY_MS, host: 90 * DAY_MS } as const

export type SessionKind = keyof typeof LIFETIME_MS

export interface User {
  id: string
  displayName: string
  avatarUrl: string | null
  ageConfirmed: boolean
  bannedUntil: number | null
  email: string | null
  emailVerified: boolean
}

/** 256 random bits, safe in a URL. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createSession(db: D1Database, userId: string, kind: SessionKind) {
  const token = randomToken()
  const now = Date.now()
  await db
    .prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(await hashToken(token), userId, kind, now, now + LIFETIME_MS[kind])
    .run()
  return { token, maxAgeSeconds: LIFETIME_MS[kind] / 1000 }
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export const CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

/** The token a request carries: the browser cookie, or a bearer token from the host app. */
export function requestToken(request: Request): string | null {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]
  return bearer ?? readCookie(request, SESSION_COOKIE)
}

interface UserRow {
  id: string
  display_name: string
  avatar_url: string | null
  age_confirmed_at: number | null
  banned_until: number | null
  email: string | null
  email_verified_at: number | null
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    ageConfirmed: row.age_confirmed_at !== null,
    bannedUntil: row.banned_until,
    email: row.email,
    emailVerified: row.email_verified_at !== null,
  }
}

/** The signed-in user, or null for a guest, an expired session or a banned account. */
export async function currentUser(request: Request, db: D1Database): Promise<User | null> {
  const token = requestToken(request)
  if (!token) return null
  const row = await db
    .prepare(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .bind(await hashToken(token), Date.now())
    .first<UserRow>()
  if (!row) return null
  const user = toUser(row)
  return user.bannedUntil !== null && user.bannedUntil > Date.now() ? null : user
}

export async function deleteSession(request: Request, db: D1Database): Promise<void> {
  const token = requestToken(request)
  if (token) {
    await db
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await hashToken(token))
      .run()
  }
}
