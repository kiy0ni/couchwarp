/**
 * Profiles: a name, a picture and a colour each person chooses, and badges earned from
 * what they did. Badges are worked out on demand from history and friends, never stored.
 *
 * - `PATCH  /api/me/profile`: `{ displayName?, color? }`
 * - `PUT    /api/me/avatar`: the picture itself, JPEG, PNG or WebP, 256 KB at most
 * - `DELETE /api/me/avatar`
 * - `GET    /api/users/:id`: a public profile
 * - `GET    /api/users/:id/avatar`
 */

import { currentUser, type User } from './auth/sessions'
import { fromOurPages, json, problem } from './http'
import { isAdmin } from './reports'

export const PROFILE_COLORS = ['coral', 'sky', 'lime', 'amber'] as const
export type ProfileColor = (typeof PROFILE_COLORS)[number]

const MAX_AVATAR_BYTES = 256 * 1024
const MIN_NAME = 2
const MAX_NAME = 32
/** Accounts made before this were there for the first games. */
const PIONEER_UNTIL = Date.UTC(2027, 0, 1)
const REGULAR_HOST_GAMES = 10
const REGULAR_GAMES = 10
const SOCIAL_FRIENDS = 5

export type Badge = 'team' | 'pioneer' | 'host' | 'regular-host' | 'regular' | 'social'

export async function handleProfiles(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const method = request.method

  const avatar = pathname.match(/^\/api\/users\/([0-9a-zA-Z-]{1,64})\/avatar$/)?.[1]
  if (avatar && method === 'GET') return serveAvatar(env, avatar)
  const profile = pathname.match(/^\/api\/users\/([0-9a-zA-Z-]{1,64})$/)?.[1]
  if (profile && method === 'GET') return publicProfile(env, profile)

  if (pathname !== '/api/me/profile' && pathname !== '/api/me/avatar') return null
  if (!fromOurPages(request, env)) return problem(403, 'cross-site')
  const user = await currentUser(request, env.DB)
  if (!user) return problem(401, 'signed-out')
  if (pathname === '/api/me/profile' && method === 'PATCH') return update(request, env, user)
  if (pathname === '/api/me/avatar' && method === 'PUT') return upload(request, env, user)
  if (pathname === '/api/me/avatar' && method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM avatars WHERE user_id = ?').bind(user.id),
      env.DB.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').bind(user.id),
    ])
    return json({ avatarUrl: null })
  }
  return problem(404, 'not-found')
}

/** A name as people will see it: no control characters, single spaces, 2 to 32 long. */
export function cleanDisplayName(raw: string): string | null {
  const visible = [...raw].filter((char) => {
    const code = char.codePointAt(0) ?? 0
    return code >= 0x20 && code !== 0x7f
  })
  const name = visible.join('').replace(/\s+/g, ' ').trim()
  const length = [...name].length
  return length >= MIN_NAME && length <= MAX_NAME ? name : null
}

async function update(request: Request, env: Env, user: User): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    displayName?: unknown
    color?: unknown
  } | null
  if (!body) return problem(400, 'invalid-profile')
  const statements: D1PreparedStatement[] = []
  if (body.displayName !== undefined) {
    const name = typeof body.displayName === 'string' ? cleanDisplayName(body.displayName) : null
    if (!name) return problem(400, 'invalid-name')
    statements.push(
      env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(name, user.id),
    )
  }
  if (body.color !== undefined) {
    const color = body.color === null ? null : body.color
    if (color !== null && !PROFILE_COLORS.includes(color as ProfileColor)) {
      return problem(400, 'invalid-color')
    }
    statements.push(env.DB.prepare('UPDATE users SET color = ? WHERE id = ?').bind(color, user.id))
  }
  if (statements.length > 0) await env.DB.batch(statements)
  return publicProfile(env, user.id)
}

/** The type the bytes really are, whatever the request says. */
export function imageType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte)
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  const riff = starts(0x52, 0x49, 0x46, 0x46)
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  return riff && webp ? 'image/webp' : null
}

async function upload(request: Request, env: Env, user: User): Promise<Response> {
  const length = Number(request.headers.get('Content-Length') ?? 0)
  if (length > MAX_AVATAR_BYTES) return problem(413, 'avatar-too-large')
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
    return problem(413, 'avatar-too-large')
  }
  const type = imageType(bytes)
  if (!type) return problem(415, 'not-an-image')
  const now = Date.now()
  const avatarUrl = `/api/users/${user.id}/avatar?v=${now}`
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO avatars (user_id, type, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET type = excluded.type, data = excluded.data,
         updated_at = excluded.updated_at`,
    ).bind(user.id, type, bytes, now),
    env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatarUrl, user.id),
  ])
  return json({ avatarUrl })
}

async function serveAvatar(env: Env, userId: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT type, data FROM avatars WHERE user_id = ?')
    .bind(userId)
    .first<{ type: string; data: ArrayBuffer }>()
  if (!row) return new Response('Not found', { status: 404 })
  return new Response(row.data, {
    headers: {
      'Content-Type': row.type,
      'X-Content-Type-Options': 'nosniff',
      // The address changes with each new picture, so a long cache is safe.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

async function publicProfile(env: Env, userId: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT id, display_name, avatar_url, color, tag, created_at, banned_until FROM users WHERE id = ?',
  )
    .bind(userId)
    .first<{
      id: string
      display_name: string
      avatar_url: string | null
      color: string | null
      tag: number | null
      created_at: number
      banned_until: number | null
    }>()
  if (!row) return problem(404, 'not-found')
  return json({
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    color: row.color,
    tag: row.tag,
    memberSince: row.created_at,
    badges: await badges(env, row.id, row.created_at),
  })
}

/** What someone earned, from what Couchwarp keeps anyway: history, friends, the team list. */
export async function badges(env: Env, userId: string, createdAt: number): Promise<Badge[]> {
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(DISTINCT room_code) FROM play_history WHERE user_id = ?1 AND hosted = 1) AS hosted,
       (SELECT COUNT(DISTINCT room_code) FROM play_history WHERE user_id = ?1 AND hosted = 0) AS joined,
       (SELECT COUNT(*) FROM friendships WHERE accepted_at IS NOT NULL
          AND (requester_id = ?1 OR addressee_id = ?1)) AS friends`,
  )
    .bind(userId)
    .first<{ hosted: number; joined: number; friends: number }>()
  const earned: Badge[] = []
  if (isAdmin(env, { id: userId } as User)) earned.push('team')
  if (createdAt < PIONEER_UNTIL) earned.push('pioneer')
  if ((counts?.hosted ?? 0) >= REGULAR_HOST_GAMES) earned.push('regular-host')
  else if ((counts?.hosted ?? 0) >= 1) earned.push('host')
  if ((counts?.joined ?? 0) >= REGULAR_GAMES) earned.push('regular')
  if ((counts?.friends ?? 0) >= SOCIAL_FRIENDS) earned.push('social')
  return earned
}
