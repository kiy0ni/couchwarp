import {
  AppWindow,
  ArrowClockwise,
  Copy,
  Desktop,
  DownloadSimple,
  GameController,
  GearSix,
  House,
  Keyboard,
  MonitorPlay,
  Mouse,
  type Icon as PhosphorIcon,
  ShieldCheck,
  SquaresFour,
  Trophy,
  UserCircle,
  UsersThree,
} from '@phosphor-icons/react'

/** Phosphor icons (MIT), one name per meaning in Couchwarp. */
const ICONS = {
  home: House,
  rooms: SquaresFour,
  host: MonitorPlay,
  friends: UsersThree,
  settings: GearSix,
  shield: ShieldCheck,
  pad: GameController,
  keyboard: Keyboard,
  mouse: Mouse,
  app: AppWindow,
  user: UserCircle,
  download: DownloadSimple,
  copy: Copy,
  refresh: ArrowClockwise,
  computer: Desktop,
  badge: Trophy,
} satisfies Record<string, PhosphorIcon>

export type IconName = keyof typeof ICONS

/** Line icons by default; `duotone` fills the shape lightly, for what is selected. */
export function Icon({
  name,
  size = 20,
  weight = 'regular',
}: {
  name: IconName
  size?: number
  weight?: 'regular' | 'duotone' | 'fill' | 'bold'
}) {
  const Glyph = ICONS[name]
  return <Glyph className="icon" size={size} weight={weight} aria-hidden="true" focusable="false" />
}
