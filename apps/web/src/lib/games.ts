import { useEffect, useState } from 'react'

/** A game the server recognised. Mirrors `services/edge/src/games.ts`. */
export interface GameInfo {
  appId: number
  name: string
  /** Wide picture, 460 by 215. */
  header: string
  /** Tall cover; not every game has one. */
  cover: string
}

/** The picture shown for any game the server does not know. */
export const GENERIC_COVER = '/covers/generic.jpg'

export async function lookUpGame(name: string): Promise<GameInfo | null> {
  const response = await fetch(`/api/games/lookup?q=${encodeURIComponent(name.slice(0, 120))}`)
  if (!response.ok) return null
  return ((await response.json()) as { game: GameInfo | null }).game
}

/** The first of `names` that is a known game: a window's app name, then its title. */
export function useKnownGame(...names: (string | null | undefined)[]): GameInfo | null {
  const [game, setGame] = useState<GameInfo | null>(null)
  const key = names.filter(Boolean).join('\n')
  useEffect(() => {
    let alive = true
    setGame(null)
    ;(async () => {
      for (const name of key.split('\n').filter(Boolean)) {
        const found = await lookUpGame(name).catch(() => null)
        if (found) {
          if (alive) setGame(found)
          return
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [key])
  return game
}
