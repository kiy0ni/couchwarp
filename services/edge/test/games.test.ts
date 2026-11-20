import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { matchScore, normalizeGameName } from '../src/games'
import { SITE } from './helpers'

function storeAnswers(items: unknown[]) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ total: items.length, items }))
}

async function lookUp(q: string) {
  const response = await exports.default.fetch(
    `${SITE}/api/games/lookup?q=${encodeURIComponent(q)}`,
  )
  return response.json<{ game: { appId: number; name: string; header: string } | null }>()
}

afterEach(() => vi.restoreAllMocks())

describe('known games', () => {
  it('match a store title exactly, or a window title that starts with it', () => {
    expect(normalizeGameName('Overcooked!® 2')).toBe('overcooked 2')
    expect(normalizeGameName('Gang Beasts.exe')).toBe('gang beasts')
    expect(matchScore('gang beasts', 'Gang Beasts')).toBe(3)
    expect(matchScore('Gang Beasts - 1.24', 'Gang Beasts')).toBe(2)
    expect(matchScore('Finder', 'Finder Simulator')).toBe(0)
    expect(matchScore('Go', 'Go')).toBe(3)
    expect(matchScore('Go home', 'Go')).toBe(0)
  })

  it('finds the game, then answers from the cache', async () => {
    const store = storeAnswers([
      { type: 'app', id: 999, name: 'Gang Beasts Soundtrack' },
      { type: 'app', id: 285900, name: 'Gang Beasts' },
    ])
    const first = await lookUp('Gang Beasts')
    expect(first.game).toMatchObject({ appId: 285900, name: 'Gang Beasts' })
    expect(first.game?.header).toContain('/285900/header.jpg')
    await lookUp('gang beasts')
    expect(store).toHaveBeenCalledTimes(1)
  })

  it('remembers a miss, and treats a failing store as one', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect((await lookUp('Finder')).game).toBeNull()
    const row = await env.DB.prepare('SELECT app_id FROM game_lookups WHERE query = ?')
      .bind('finder')
      .first()
    expect(row).toEqual({ app_id: null })
  })
})
