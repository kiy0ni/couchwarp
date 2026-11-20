/**
 * Room server. Routes:
 *
 * - `GET /api/host` (WebSocket): opens a new room and keeps the host connected to it.
 * - `GET /api/rooms?game=&continent=&free=1`: public rooms.
 * - `GET /api/rooms/:code`: `{ open }`, so the join page can check a code before asking a name.
 * - `GET /api/rooms/:code/guest?name=` (WebSocket): joins a room as a guest.
 * - `GET /api/rooms/:code/console` (WebSocket): the host console, after an `auth` message.
 * - `GET /api/rooms/:code/thumbnail`: the latest picture of a public room.
 * - `POST /api/rooms/:code/report`: reports, see `reports.ts`.
 * - `/api/auth/*`, `/api/me*`: accounts, see `auth/routes.ts` and `auth/password.ts`.
 * - `/api/friends*`: friends and presence, see `friends.ts`.
 * - `/api/me/profile`, `/api/me/avatar`, `/api/users/:id*`: profiles, see `profiles.ts`.
 * - `/api/admin/*`: report handling, for admins only.
 * - `GET /api/games/lookup?q=`: a known game's title and cover, see `games.ts`.
 * - `GET /api/config`: what this server offers, `{ publicRooms, relay }`.
 * - `GET /api/downloads`: where to get the desktop app, `{ mac, windows, linux, linuxDeb }`,
 *   null without one.
 * - `/api/updates/*`: the desktop app's update manifest and files, see `updates.ts`.
 *
 * A daily cron trigger runs `cleanUp`.
 *
 * Every other path serves the web client (see `assets` in `wrangler.jsonc`).
 */

import { isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { handlePasswords } from './auth/password'
import { handleAccounts } from './auth/routes'
import { currentUser } from './auth/sessions'
import { cleanUp } from './cleanup'
import { list } from './directory'
import { handleFriends } from './friends'
import { handleGames } from './games'
import { json, siteOrigin } from './http'
import { handleProfiles } from './profiles'
import { handleAdmin, report } from './reports'
import { ARRIVAL_HEADER, type Arrival } from './room'
import { randomRoomCode } from './room-code'
import { handleUpdates, releaseDownloads } from './updates'

export { Room } from './room'

/** Code draws before giving up. A collision is a one in hundreds of millions event. */
const MAX_CODE_DRAWS = 5

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const handled =
      (await handlePasswords(request, env)) ??
      (await handleProfiles(request, env)) ??
      (await handleAccounts(request, env)) ??
      (await handleFriends(request, env)) ??
      (await handleGames(request, env)) ??
      (await handleUpdates(request, env, siteOrigin(request, env))) ??
      (await handleAdmin(request, env))
    if (handled) return handled
    if (url.pathname === '/api/host') return openRoom(request, env)
    if (url.pathname === '/api/rooms') return listRooms(request, env)
    if (url.pathname === '/api/config') {
      return json({
        publicRooms: env.PUBLIC_ROOMS === 'on',
        relay: Boolean(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN),
      })
    }
    if (url.pathname === '/api/downloads') {
      const release = await releaseDownloads(env, siteOrigin(request, env), Date.now())
      return json({
        ...release,
        mac: env.DOWNLOAD_MAC_URL ?? release.mac,
        windows: env.DOWNLOAD_WINDOWS_URL ?? release.windows,
      })
    }

    const match = url.pathname.match(
      /^\/api\/rooms\/([^/]+)(?:\/(guest|console|thumbnail|report))?$/,
    )
    if (!match?.[1]) return new Response('Not found', { status: 404 })
    const code = normalizeRoomCode(decodeURIComponent(match[1]))
    if (!isRoomCode(code)) return json({ open: false })

    const route = match[2] ?? 'info'
    if (route === 'report') return report(request, env, code, await reporterHash(request))
    const room = env.ROOMS.getByName(code)
    if (route === 'info' || route === 'thumbnail') {
      return room.fetch(roomRequest(request, `${code}/${route}`))
    }
    if (!isWebSocketUpgrade(request)) return expectWebSocket()
    if (route === 'console') return room.fetch(roomRequest(request, `${code}/console`))
    const arrival = await arrivalOf(request, env, code)
    return room.fetch(roomRequest(request, `${code}/guest${url.search}`, arrival))
  },

  async scheduled(_controller, env): Promise<void> {
    await cleanUp(env.DB, Date.now())
  },
} satisfies ExportedHandler<Env>

/** Salted apart from room bans: only counts how often one place reports. */
function reporterHash(request: Request): Promise<string> {
  return sha256(`report:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`)
}

async function openRoom(request: Request, env: Env): Promise<Response> {
  if (!isWebSocketUpgrade(request)) return expectWebSocket()
  for (let draw = 0; draw < MAX_CODE_DRAWS; draw++) {
    const code = randomRoomCode()
    const arrival = await arrivalOf(request, env, code)
    const response = await env.ROOMS.getByName(code).fetch(
      roomRequest(request, `${code}/host`, arrival),
    )
    if (response.status !== 409) return response
  }
  return new Response('No free room code, try again', { status: 503 })
}

async function listRooms(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams
  const cards = await list(
    env.DB,
    {
      game: params.get('game'),
      continent: params.get('continent'),
      freeSeats: params.get('free') === '1',
    },
    geo(request),
    Date.now(),
  )
  return json({ rooms: cards }, 200, { 'Cache-Control': 'no-store' })
}

/** Who arrives: their account if signed in, and where from. */
async function arrivalOf(request: Request, env: Env, code: string): Promise<Arrival> {
  const user = await currentUser(request, env.DB)
  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  return {
    account: user
      ? { userId: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl }
      : null,
    // Salted with the room code: a ban works within the room, and the stored value
    // cannot be matched against another room's.
    addressHash: await sha256(`${code}:${address}`),
    ...geo(request),
  }
}

function geo(request: Request): { country: string | null; continent: string | null } {
  const cf = request.cf as { country?: string; continent?: string } | undefined
  return { country: cf?.country ?? null, continent: cf?.continent ?? null }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function roomRequest(request: Request, path: string, arrival?: Arrival): Request {
  const forwarded = new Request(`https://room/${path}`, request)
  // Encoded: names may hold any character, and header values are ASCII.
  if (arrival) forwarded.headers.set(ARRIVAL_HEADER, encodeURIComponent(JSON.stringify(arrival)))
  return forwarded
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
}

function expectWebSocket(): Response {
  return new Response('Expected a WebSocket upgrade', { status: 426 })
}
