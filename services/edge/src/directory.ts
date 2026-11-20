/** The public room list in D1, written by the rooms, read by the listing page. */

import { cachedGame } from './games'

export interface RoomCard {
  code: string
  title: string
  game: string
  hostName: string
  players: number
  maxPlayers: number
  spectators: number
  continent: string | null
  avatars: (string | null)[]
  thumbnailUrl: string | null
  /** The game's wide picture when it is a known game; the page has a generic one. */
  gameHeader: string | null
  /** A rough idea of the ping from the looker's place: same country, same continent, or far. */
  proximity: 'near' | 'region' | 'far'
}

export interface Listing {
  code: string
  title: string
  game: string
  hostName: string
  hostUserId: string | null
  players: number
  maxPlayers: number
  spectators: number
  country: string | null
  continent: string | null
  avatars: (string | null)[]
  hasThumbnail: boolean
}

/** Listed rooms refresh every minute; anything older is gone. */
export const FRESH_FOR_MS = 2 * 60 * 1000

export async function publish(db: D1Database, room: Listing, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO rooms (code, title, game, host_name, host_user_id, players, max_players,
         spectators, country, continent, avatars, has_thumbnail, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      room.code,
      room.title,
      room.game,
      room.hostName,
      room.hostUserId,
      room.players,
      room.maxPlayers,
      room.spectators,
      room.country,
      room.continent,
      JSON.stringify(room.avatars),
      room.hasThumbnail ? 1 : 0,
      now,
    )
    .run()
}

export async function unpublish(db: D1Database, code: string): Promise<void> {
  await db.prepare('DELETE FROM rooms WHERE code = ?').bind(code).run()
}

interface Row {
  code: string
  title: string
  game: string
  host_name: string
  players: number
  max_players: number
  spectators: number
  country: string | null
  continent: string | null
  avatars: string
  has_thumbnail: number
}

export interface Filters {
  game: string | null
  continent: string | null
  freeSeats: boolean
}

/** Public rooms, the most players first, with each one's proximity to `looker`. */
export async function list(
  db: D1Database,
  filters: Filters,
  looker: { country: string | null; continent: string | null },
  now: number,
): Promise<RoomCard[]> {
  const conditions = ['updated_at > ?']
  const values: (string | number)[] = [now - FRESH_FOR_MS]
  if (filters.game) {
    conditions.push('game LIKE ?')
    values.push(`%${filters.game.replace(/[%_]/g, '')}%`)
  }
  if (filters.continent) {
    conditions.push('continent = ?')
    values.push(filters.continent)
  }
  if (filters.freeSeats) conditions.push('players < max_players')
  const { results } = await db
    .prepare(
      `SELECT * FROM rooms WHERE ${conditions.join(' AND ')} ORDER BY players DESC, updated_at DESC LIMIT 60`,
    )
    .bind(...values)
    .all<Row>()
  const known = await knownGames(db, results)
  return results.map((row) => ({
    code: row.code,
    title: row.title,
    game: known.get(row.game)?.name ?? row.game,
    gameHeader: known.get(row.game)?.header ?? null,
    hostName: row.host_name,
    players: row.players,
    maxPlayers: row.max_players,
    spectators: row.spectators,
    continent: row.continent,
    avatars: JSON.parse(row.avatars),
    thumbnailUrl: row.has_thumbnail ? `/api/rooms/${row.code}/thumbnail` : null,
    proximity:
      looker.country && row.country === looker.country
        ? 'near'
        : looker.continent && row.continent === looker.continent
          ? 'region'
          : 'far',
  }))
}

/** The known games among the listed rooms, by the name each host gave; the rooms looked them up. */
async function knownGames(db: D1Database, rows: Row[]) {
  const names = [...new Set(rows.map((row) => row.game).filter(Boolean))]
  const found = await Promise.all(names.map((name) => cachedGame(db, name)))
  return new Map(names.map((name, index) => [name, found[index] ?? null]))
}
