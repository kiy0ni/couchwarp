import { t } from '../i18n'

const LIGHTS = 4

/**
 * Four lights, the one for this player lit in its colour, like the player indicator on a
 * console controller. Past four players the pattern repeats, so the number is shown too.
 */
export function PlayerBadge({ slot }: { slot: number }) {
  const lit = (slot - 1) % LIGHTS
  return (
    <span className="lights" data-player={lit + 1} title={t.play.player(slot)}>
      <span className="visually-hidden">{t.play.player(slot)}</span>
      {Array.from({ length: LIGHTS }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: four fixed lights
        <i key={index} aria-hidden="true" data-lit={index === lit || undefined} />
      ))}
      {slot > LIGHTS && (
        <span className="lights__number" aria-hidden="true">
          {slot}
        </span>
      )}
    </span>
  )
}
