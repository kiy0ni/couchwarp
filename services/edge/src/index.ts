/**
 * Room server. Routes:
 *
 * - `GET /api/host` (WebSocket): opens a new room and keeps the host connected to it.
 * - `GET /api/rooms/:code` : `{ open }`, so the join page can check a code before asking a name.
 * - `GET /api/rooms/:code/guest?name=` (WebSocket): joins a room as a guest.
 *
 * Every other path serves the web client (see `assets` in `wrangler.jsonc`).
 */

import { isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { randomRoomCode } from './room-code'

export { Room } from './room'

/** Code draws before giving up. A collision is a one in hundreds of millions event. */
const MAX_CODE_DRAWS = 5

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/host') return openRoom(request, env)

    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/guest)?$/)
    if (!match?.[1]) return new Response('Not found', { status: 404 })

    const code = normalizeRoomCode(decodeURIComponent(match[1]))
    if (!isRoomCode(code)) return Response.json({ open: false })
    if (match[2] && !isWebSocketUpgrade(request)) return expectWebSocket()

    const route = match[2] ? `guest${url.search}` : 'info'
    return env.ROOMS.getByName(code).fetch(roomRequest(request, `${code}/${route}`))
  },
} satisfies ExportedHandler<Env>

async function openRoom(request: Request, env: Env): Promise<Response> {
  if (!isWebSocketUpgrade(request)) return expectWebSocket()
  for (let draw = 0; draw < MAX_CODE_DRAWS; draw++) {
    const code = randomRoomCode()
    const response = await env.ROOMS.getByName(code).fetch(roomRequest(request, `${code}/host`))
    if (response.status !== 409) return response
  }
  return new Response('No free room code, try again', { status: 503 })
}

function roomRequest(request: Request, path: string): Request {
  return new Request(`https://room/${path}`, request)
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
}

function expectWebSocket(): Response {
  return new Response('Expected a WebSocket upgrade', { status: 426 })
}
