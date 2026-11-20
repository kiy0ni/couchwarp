/**
 * Known games: from the name of a window or what the host typed, the game's real title
 * and its cover, found in the Steam store and kept for a while. Anything else gets the
 * generic cover on the page.
 *
 * - `GET /api/games/lookup?q=`: `{ game: GameInfo | null }`
 */

import { json, problem } from './http'

const FOUND_FOR_MS = 30 * 24 * 60 * 60 * 1000
const MISSED_FOR_MS = 7 * 24 * 60 * 60 * 1000
const MAX_QUERY = 120
const IMAGES = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

export interface GameInfo {
  appId: number
  name: string
  /** Wide picture, 460 by 215. */
  header: string
  /** Tall cover, 600 by 900; not every game has one, so pages fall back to the header. */
  cover: string
}

export async function handleGames(request: Request, env: Env): Promise<Response | null> {
  const { pathname, searchParams } = new URL(request.url)
  if (pathname !== '/api/games/lookup') return null
  if (request.method !== 'GET') return problem(405, 'method-not-allowed')
  const query = searchParams.get('q') ?? ''
  if (!query.trim() || query.length > MAX_QUERY) return problem(400, 'invalid-query')
  return json({ game: await lookUpGame(env.DB, query, Date.now()) }, 200, {
    'Cache-Control': 'public, max-age=86400',
  })
}

/** Lower case, no trademark signs, accents or punctuation, single spaces. */
export function normalizeGameName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.exe$/, '')
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** How well a store title answers a query: exact, then a window title that starts with it. */
export function matchScore(query: string, title: string): number {
  const q = normalizeGameName(query)
  const name = normalizeGameName(title)
  if (!q || !name) return 0
  if (q === name) return 3
  // "Gang Beasts - 1.24" or "Overcooked! 2 (DX11)": the window adds to the game's name.
  if (name.length >= 5 && q.startsWith(`${name} `)) return 2
  return 0
}

/** What the cache already knows, without asking the store: for lists, which must stay fast. */
export async function cachedGame(db: D1Database, query: string): Promise<GameInfo | null> {
  const row = await db
    .prepare('SELECT app_id, name FROM game_lookups WHERE query = ?')
    .bind(normalizeGameName(query))
    .first<{ app_id: number | null; name: string | null }>()
  return row?.app_id ? info(row.app_id, row.name ?? query) : null
}

export async function lookUpGame(db: D1Database, query: string, now: number) {
  const key = normalizeGameName(query)
  if (!key) return null
  const cached = await db
    .prepare('SELECT app_id, name, fetched_at FROM game_lookups WHERE query = ?')
    .bind(key)
    .first<{ app_id: number | null; name: string | null; fetched_at: number }>()
  const fresh =
    cached && now - cached.fetched_at < (cached.app_id === null ? MISSED_FOR_MS : FOUND_FOR_MS)
  if (cached && fresh) return cached.app_id ? info(cached.app_id, cached.name ?? query) : null

  const found = await searchStore(query)
  await db
    .prepare(
      `INSERT INTO game_lookups (query, app_id, name, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (query) DO UPDATE SET app_id = excluded.app_id, name = excluded.name,
         fetched_at = excluded.fetched_at`,
    )
    .bind(key, found?.id ?? null, found?.name ?? null, now)
    .run()
  return found ? info(found.id, found.name) : null
}

function info(appId: number, name: string): GameInfo {
  return {
    appId,
    name,
    header: `${IMAGES}/${appId}/header.jpg`,
    cover: `${IMAGES}/${appId}/library_600x900.jpg`,
  }
}

interface StoreItem {
  id?: unknown
  name?: unknown
  type?: unknown
}

/** The best matching game in the Steam store, or null. A store that fails is a miss. */
async function searchStore(query: string): Promise<{ id: number; name: string } | null> {
  const url = new URL('https://store.steampowered.com/api/storesearch/')
  url.searchParams.set('term', query.replace(/\.exe$/i, ''))
  url.searchParams.set('l', 'english')
  url.searchParams.set('cc', 'US')
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const body = (await response.json()) as { items?: StoreItem[] }
    let best: { id: number; name: string; score: number } | null = null
    for (const item of body.items ?? []) {
      if (typeof item.id !== 'number' || typeof item.name !== 'string') continue
      if (item.type !== undefined && item.type !== 'app') continue
      const score = matchScore(query, item.name)
      if (score > (best?.score ?? 0)) best = { id: item.id, name: item.name, score }
    }
    return best ? { id: best.id, name: best.name } : null
  } catch (error) {
    console.warn('Steam store search failed', error)
    return null
  }
}
