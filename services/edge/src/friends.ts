/**
 * Friends: a request, accepted by the other person. A request needs a game played
 * together, so nobody can be asked by a stranger. Friends see each other's presence:
 * in a game or not, and the code only when that game is public.
 *
 * - `GET    /api/friends`
 * - `POST   /api/friends`: `{ userId }` for someone met in a game, or `{ tag: "Name#123456" }`;
 *   asks, or accepts their request if there is one
 * - `DELETE /api/friends/:userId`: declines, cancels or ends a friendship
 * - `PUT    /api/friends/:userId/permissions`: `{ keyboard, mouse }`, what this friend may
 *   use from the start in the games you host
 */

import { currentUser, type User } from './auth/sessions'
import { FRESH_FOR_MS } from './directory'
import { fromOurPages, json, problem } from './http'

const HOUR_MS = 60 * 60 * 1000
/** Friend requests one person may send by tag in an hour. */
const REQUESTS_PER_HOUR = 20

/** Past this, an unclosed history row is a room that crashed, not a presence. */
const PRESENCE_FOR_MS = 12 * 60 * 60 * 1000

export interface Presence {
  title: string
  game: string
  hosting: boolean
  /** Only for a public game: anyone could join it from the list anyway. */
  roomCode: string | null
}

export interface Friend {
  userId: string
  displayName: string
  avatarUrl: string | null
  color: string | null
  presence: Presence | null
  /** What you let this friend do in your games, beyond the controller. */
  permissions: { keyboard: boolean; mouse: boolean }
}

interface FriendRow {
  id: string
  display_name: string
  avatar_url: string | null
  color: string | null
  accepted_at: number | null
  incoming: number
  keyboard: number | null
  mouse: number | null
}

interface PresenceRow {
  user_id: string
  room_code: string
  title: string
  game: string
  hosted: number
  listed: number
}

/** Handles `/api/friends*`, or returns null for other paths. */
export async function handleFriends(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname !== '/api/friends' && !pathname.startsWith('/api/friends/')) return null
  const user = await currentUser(request, env.DB)
  if (!user) return problem(401, 'signed-out')

  if (pathname === '/api/friends' && request.method === 'GET') return json(await friends(env, user))
  if (!fromOurPages(request, env)) return problem(403, 'cross-site')
  if (pathname === '/api/friends' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as {
      userId?: unknown
      tag?: unknown
    } | null
    if (typeof body?.tag === 'string') return askByTag(env, user, body.tag)
    if (typeof body?.userId !== 'string') return problem(400, 'invalid-user')
    return ask(env, user, body.userId)
  }
  const permissions = pathname.match(/^\/api\/friends\/([0-9a-zA-Z-]{1,64})\/permissions$/)?.[1]
  if (permissions && request.method === 'PUT') return grant(request, env, user, permissions)
  const target = pathname.match(/^\/api\/friends\/([0-9a-zA-Z-]{1,64})$/)?.[1]
  if (target && request.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?)
           OR (requester_id = ? AND addressee_id = ?)`,
      ).bind(user.id, target, target, user.id),
      // Permissions only make sense between friends.
      env.DB.prepare(
        `DELETE FROM friend_permissions WHERE (owner_id = ? AND friend_id = ?)
           OR (owner_id = ? AND friend_id = ?)`,
      ).bind(user.id, target, target, user.id),
    ])
    return json(await friends(env, user))
  }
  return problem(404, 'not-found')
}

/** `Name#123456`: the name as shown, then the six-digit tag. */
export function parseTag(text: string): { name: string; tag: number } | null {
  const match = text.trim().match(/^(.{2,32})#(\d{6})$/u)
  if (!match?.[1] || !match[2]) return null
  return { name: match[1].trim(), tag: Number(match[2]) }
}

const sameName = (a: string, b: string) =>
  a.normalize('NFC').toLocaleLowerCase('fr') === b.normalize('NFC').toLocaleLowerCase('fr')

/** Adds someone by name and tag. Both must match, so a tag alone finds no one. */
async function askByTag(env: Env, user: User, text: string): Promise<Response> {
  const parsed = parseTag(text)
  if (!parsed) return problem(400, 'invalid-tag')
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM friendships WHERE requester_id = ? AND created_at > ?',
  )
    .bind(user.id, Date.now() - HOUR_MS)
    .first<number>('count')
  if ((recent ?? 0) >= REQUESTS_PER_HOUR) return problem(429, 'too-many-requests')
  const other = await env.DB.prepare('SELECT id, display_name FROM users WHERE tag = ?')
    .bind(parsed.tag)
    .first<{ id: string; display_name: string }>()
  if (!other || !sameName(other.display_name, parsed.name)) return problem(404, 'no-such-player')
  return ask(env, user, other.id, { metInGame: false })
}

async function ask(
  env: Env,
  user: User,
  otherId: string,
  { metInGame } = { metInGame: true },
): Promise<Response> {
  if (otherId === user.id) return problem(400, 'invalid-user')
  const theirRequest = await env.DB.prepare(
    'SELECT accepted_at FROM friendships WHERE requester_id = ? AND addressee_id = ?',
  )
    .bind(otherId, user.id)
    .first<{ accepted_at: number | null }>()
  if (theirRequest) {
    if (theirRequest.accepted_at === null) {
      await env.DB.prepare(
        'UPDATE friendships SET accepted_at = ? WHERE requester_id = ? AND addressee_id = ?',
      )
        .bind(Date.now(), otherId, user.id)
        .run()
    }
    return json(await friends(env, user))
  }
  const playedTogether = await env.DB.prepare(
    `SELECT 1 FROM play_history mine JOIN play_history theirs ON theirs.room_code = mine.room_code
     WHERE mine.user_id = ? AND theirs.user_id = ? LIMIT 1`,
  )
    .bind(user.id, otherId)
    .first()
  // From a game's player list, only people actually met there; by tag, anyone named right.
  if (metInGame && !playedTogether) return problem(403, 'never-played-together')
  await env.DB.prepare(
    'INSERT OR IGNORE INTO friendships (requester_id, addressee_id, created_at) VALUES (?, ?, ?)',
  )
    .bind(user.id, otherId, Date.now())
    .run()
  return json(await friends(env, user))
}

async function grant(request: Request, env: Env, user: User, friendId: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    keyboard?: unknown
    mouse?: unknown
  } | null
  if (typeof body?.keyboard !== 'boolean' || typeof body.mouse !== 'boolean') {
    return problem(400, 'invalid-permissions')
  }
  const friendship = await env.DB.prepare(
    `SELECT 1 FROM friendships WHERE accepted_at IS NOT NULL
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
  )
    .bind(user.id, friendId, friendId, user.id)
    .first()
  if (!friendship) return problem(404, 'not-a-friend')
  await env.DB.prepare(
    `INSERT INTO friend_permissions (owner_id, friend_id, keyboard, mouse) VALUES (?, ?, ?, ?)
     ON CONFLICT (owner_id, friend_id) DO UPDATE SET keyboard = excluded.keyboard, mouse = excluded.mouse`,
  )
    .bind(user.id, friendId, body.keyboard ? 1 : 0, body.mouse ? 1 : 0)
    .run()
  return json(await friends(env, user))
}

/** Friends with their presence, then requests received and sent. */
export async function friends(env: Env, user: User) {
  const { results } = await env.DB.prepare(
    `SELECT users.id, users.display_name, users.avatar_url, users.color, f.accepted_at,
       (f.addressee_id = ?1) AS incoming, p.keyboard, p.mouse
     FROM friendships f
     JOIN users ON users.id = CASE WHEN f.requester_id = ?1 THEN f.addressee_id ELSE f.requester_id END
     LEFT JOIN friend_permissions p ON p.owner_id = ?1 AND p.friend_id = users.id
     WHERE f.requester_id = ?1 OR f.addressee_id = ?1
     ORDER BY users.display_name`,
  )
    .bind(user.id)
    .all<FriendRow>()

  const accepted = results.filter((row) => row.accepted_at !== null)
  const presence = await presences(
    env,
    accepted.map((row) => row.id),
  )
  const person = (row: FriendRow) => ({
    userId: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  })
  return {
    friends: accepted.map(
      (row): Friend => ({
        ...person(row),
        color: row.color,
        presence: presence.get(row.id) ?? null,
        permissions: { keyboard: row.keyboard === 1, mouse: row.mouse === 1 },
      }),
    ),
    incoming: results.filter((row) => row.accepted_at === null && row.incoming).map(person),
    outgoing: results.filter((row) => row.accepted_at === null && !row.incoming).map(person),
  }
}

async function presences(env: Env, userIds: string[]): Promise<Map<string, Presence>> {
  const found = new Map<string, Presence>()
  if (userIds.length === 0) return found
  const now = Date.now()
  const placeholders = userIds.map(() => '?').join(', ')
  const { results } = await env.DB.prepare(
    `SELECT h.user_id, h.room_code, h.title, h.game, h.hosted,
       EXISTS (SELECT 1 FROM rooms r WHERE r.code = h.room_code AND r.updated_at > ?) AS listed
     FROM play_history h
     WHERE h.user_id IN (${placeholders}) AND h.left_at IS NULL AND h.joined_at > ?
     ORDER BY h.joined_at DESC`,
  )
    .bind(now - FRESH_FOR_MS, ...userIds, now - PRESENCE_FOR_MS)
    .all<PresenceRow>()
  for (const row of results) {
    if (found.has(row.user_id)) continue
    found.set(row.user_id, {
      title: row.title,
      game: row.game,
      hosting: row.hosted === 1,
      roomCode: row.listed ? row.room_code : null,
    })
  }
  return found
}
