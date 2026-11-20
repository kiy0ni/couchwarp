import { useState } from 'react'
import { GENERIC_COVER } from '../lib/games'

/**
 * A game's picture: the first of `sources` that loads, the generic cover when none does.
 * `shape` is the frame: wide like a store header, or tall like a game box.
 */
export function GameCover({
  sources,
  shape = 'wide',
  className = '',
}: {
  sources: readonly (string | null | undefined)[]
  shape?: 'wide' | 'tall'
  className?: string
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const usable =
    sources.find((src): src is string => Boolean(src) && !failed.has(src as string)) ??
    GENERIC_COVER
  return (
    <span className={`game-cover ${className}`} data-shape={shape}>
      <img
        src={usable}
        alt=""
        loading="lazy"
        onError={() => setFailed((previous) => new Set(previous).add(usable))}
      />
    </span>
  )
}
