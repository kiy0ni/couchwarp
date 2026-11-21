/**
 * How one controller is remapped, like Steam's controller settings: which physical button
 * plays each button of the game, the sticks' dead zone, inverted or swapped sticks. Kept
 * per controller model on this device, and applied wherever a controller is read for a
 * game, so what the tester shows is what the game gets.
 */

import { vendorProduct } from './controllers'
import { preferences, setPreferences } from './preferences'

export interface PadLayout {
  /** For a game button (standard mapping index), the physical button that plays it. */
  buttons: Record<number, number>
  /** Share of each stick's travel ignored around the centre, 0 to 0.3. */
  deadZone: number
  invertLeftY: boolean
  invertRightY: boolean
  swapSticks: boolean
}

export const DEFAULT_LAYOUT: PadLayout = {
  buttons: {},
  // Games have their own dead zone: out of the box, the sticks pass through untouched.
  deadZone: 0,
  invertLeftY: false,
  invertRightY: false,
  swapSticks: false,
}

export const MAX_DEAD_ZONE = 0.3

/** The standard mapping's buttons, in the order the settings list them. */
export const GAME_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const

/** One controller model: its vendor and product when the browser gives them, else its name. */
export function layoutKey(gamepad: Pick<Gamepad, 'id'>): string {
  const ids = vendorProduct(gamepad.id)
  return ids ? `${ids.vendor}:${ids.product}` : gamepad.id
}

/** What a game reads: buttons and axes once the layout is applied. */
export interface LogicalPad {
  buttons: { pressed: boolean; value: number }[]
  /** Left x, left y, right x, right y, each -1 to 1. */
  axes: [number, number, number, number]
}

const RELEASED = { pressed: false, value: 0 }

export function applyLayout(gamepad: Gamepad, layout: PadLayout): LogicalPad {
  const buttons = GAME_BUTTONS.map((game) => {
    const physical = gamepad.buttons[layout.buttons[game] ?? game]
    return physical ? { pressed: physical.pressed, value: physical.value } : RELEASED
  })
  let left = stick(gamepad.axes[0], gamepad.axes[1], layout.deadZone)
  let right = stick(gamepad.axes[2], gamepad.axes[3], layout.deadZone)
  if (layout.swapSticks) [left, right] = [right, left]
  if (layout.invertLeftY) left = [left[0], -left[1]]
  if (layout.invertRightY) right = [right[0], -right[1]]
  return { buttons, axes: [left[0], left[1], right[0], right[1]] }
}

/**
 * A radial dead zone: inside it the stick is centred, outside it the remaining travel is
 * stretched back to the full range, so small movements still start from zero. Each axis
 * stays within -1 to 1, as browsers give it.
 */
export function stick(
  x: number | undefined,
  y: number | undefined,
  deadZone: number,
): [number, number] {
  const dx = clamp(x ?? 0)
  const dy = clamp(y ?? 0)
  const length = Math.hypot(dx, dy)
  if (deadZone === 0) return [dx, dy]
  if (length <= deadZone) return [0, 0]
  const scale = (length - deadZone) / (1 - deadZone) / length
  return [clamp(dx * scale), clamp(dy * scale)]
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/** Plays game button `game` with physical button `physical`; its own button means no change. */
export function remap(layout: PadLayout, game: number, physical: number): PadLayout {
  const buttons = { ...layout.buttons }
  if (physical === game) delete buttons[game]
  else buttons[game] = physical
  return { ...layout, buttons }
}

/** Whether anything differs from how the controller plays out of the box. */
export function isCustom(layout: PadLayout): boolean {
  return (
    Object.keys(layout.buttons).length > 0 ||
    layout.deadZone !== DEFAULT_LAYOUT.deadZone ||
    layout.invertLeftY ||
    layout.invertRightY ||
    layout.swapSticks
  )
}

/** The layout chosen on this device for this controller's model. */
export function layoutFor(gamepad: Pick<Gamepad, 'id'>): PadLayout {
  return { ...DEFAULT_LAYOUT, ...preferences().padLayouts[layoutKey(gamepad)] }
}

export function saveLayout(gamepad: Pick<Gamepad, 'id'>, layout: PadLayout): void {
  const layouts = { ...preferences().padLayouts }
  if (isCustom(layout)) layouts[layoutKey(gamepad)] = layout
  else delete layouts[layoutKey(gamepad)]
  setPreferences({ padLayouts: layouts })
}
