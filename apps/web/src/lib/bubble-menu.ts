/**
 * Where the game menu opens next to the bubble: below a bubble in the top half of the
 * screen, above one in the bottom half, centred on it but never past the sides.
 */

/** Space between the bubble and the menu, and between the menu and the screen's edges. */
const GAP = 8
const MARGIN = 12

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface MenuPlacement {
  direction: 'down' | 'up'
  left: number
  /** From the top of the screen when opening down, from the bottom when opening up. */
  offset: number
  /** The room left on that side; the menu scrolls past it. */
  maxHeight: number
}

export function placeMenu(
  bubble: Box,
  screen: { width: number; height: number },
  menuWidth: number,
): MenuPlacement {
  const direction = bubble.top + bubble.height / 2 < screen.height / 2 ? 'down' : 'up'
  const centred = bubble.left + bubble.width / 2 - menuWidth / 2
  const left = Math.max(MARGIN, Math.min(centred, screen.width - menuWidth - MARGIN))
  const offset =
    direction === 'down' ? bubble.top + bubble.height + GAP : screen.height - bubble.top + GAP
  return { direction, left, offset, maxHeight: Math.max(0, screen.height - offset - MARGIN) }
}
