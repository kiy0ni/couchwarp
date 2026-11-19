/** A public room as the room list shows it. Mirrors `services/edge/src/directory.ts`. */
export interface RoomCard {
  code: string
  title: string
  game: string
  hostName: string
  players: number
  maxPlayers: number
  spectators: number
  continent: string | null
  /** One per seated player, null when they have no avatar. */
  avatars: (string | null)[]
  thumbnailUrl: string | null
  /** From the looker's country and continent, not a measured ping. */
  proximity: 'near' | 'region' | 'far'
}

export interface RoomFilters {
  game: string
  continent: string
  freeSeats: boolean
}

export async function fetchRooms(filters: RoomFilters, signal: AbortSignal): Promise<RoomCard[]> {
  const params = new URLSearchParams()
  if (filters.game.trim()) params.set('game', filters.game.trim())
  if (filters.continent) params.set('continent', filters.continent)
  if (filters.freeSeats) params.set('free', '1')
  const response = await fetch(`/api/rooms?${params}`, { signal })
  if (!response.ok) throw new Error(`Room list failed with HTTP ${response.status}`)
  const { rooms } = (await response.json()) as { rooms: RoomCard[] }
  return rooms
}
