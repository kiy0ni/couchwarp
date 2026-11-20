import {
  Crown,
  HandHeart,
  Medal,
  type Icon as PhosphorIcon,
  Rocket,
  Star,
  UsersThree,
} from '@phosphor-icons/react'
import { t } from '../i18n'
import type { Badge } from '../lib/profile'

const ICONS: Record<Badge, PhosphorIcon> = {
  team: Crown,
  pioneer: Rocket,
  host: Star,
  'regular-host': Medal,
  regular: HandHeart,
  social: UsersThree,
}

/** Badges as small chips: an icon, the name, and what earned it on hover and for readers. */
export function Badges({
  badges,
  compact = false,
}: {
  badges: readonly Badge[]
  compact?: boolean
}) {
  if (badges.length === 0) return null
  return (
    <ul className="badges" data-compact={compact || undefined}>
      {badges.map((badge) => {
        const Glyph = ICONS[badge]
        return (
          <li key={badge} className="badge" data-badge={badge} title={t.badges[badge].help}>
            <Glyph size={compact ? 14 : 16} weight="duotone" aria-hidden="true" />
            <span className={compact ? 'visually-hidden' : undefined}>{t.badges[badge].name}</span>
            {compact && <span className="visually-hidden">{t.badges[badge].help}</span>}
          </li>
        )
      })}
    </ul>
  )
}
