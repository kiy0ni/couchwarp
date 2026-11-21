import { useEffect, useState } from 'react'
import type { Account } from './account'

/** A game joined or hosted while signed in. Mirrors `/api/me/history`. */
export interface Played {
  roomCode: string
  title: string
  game: string
  hostName: string
  joinedAt: number
}

/** The last games of the signed-in person, newest first; null while loading. */
export function useHistory(account: Account | null | undefined): Played[] | null {
  const [games, setGames] = useState<Played[] | null>(null)
  useEffect(() => {
    if (!account) {
      setGames(account === null ? [] : null)
      return
    }
    fetch('/api/me/history')
      .then((response) => (response.ok ? response.json() : { history: [] }))
      .then(({ history }: { history: Played[] }) => setGames(history))
      .catch(() => setGames([]))
  }, [account])
  return games
}

export const playedOn = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** One row per room: its newest visit. The history comes newest first. */
export function byRoom(games: readonly Played[]): Played[] {
  const seen = new Set<string>()
  return games.filter((game) => {
    if (seen.has(game.roomCode)) return false
    seen.add(game.roomCode)
    return true
  })
}
