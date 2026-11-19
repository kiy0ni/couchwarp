import { useEffect, useRef } from 'react'

export type Direction = 'up' | 'down' | 'left' | 'right'

/**
 * Fired on the focused element before a controller moves focus. A component that uses
 * directions itself (the code entry) calls `preventDefault()` to keep focus where it is.
 */
export const NAV_EVENT = 'gamepadnav'
export type NavEvent = CustomEvent<{ direction: Direction }>

const FIRST_REPEAT_MS = 400
const NEXT_REPEAT_MS = 120
const STICK_THRESHOLD = 0.5

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Lets a controller drive the page like a TV remote: D-pad or left stick to move,
 * A to press, B to go back. Off while a game is streaming, where the pad belongs to the game.
 */
export function useGamepadNavigation(enabled: boolean, onBack?: () => void): void {
  const onBackRef = useRef(onBack)
  useEffect(() => {
    onBackRef.current = onBack
  }, [onBack])

  useEffect(() => {
    if (!enabled) return
    let frame = 0
    let held: { key: string; nextAt: number } | null = null

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const key = pressedKey()
      if (!key) {
        held = null
        return
      }
      if (held?.key === key && now < held.nextAt) return
      const repeat = held?.key === key
      held = { key, nextAt: now + (repeat ? NEXT_REPEAT_MS : FIRST_REPEAT_MS) }
      if (key === 'a') {
        if (!repeat) activeElement()?.click()
      } else if (key === 'b') {
        if (!repeat) onBackRef.current?.()
      } else {
        navigate(key as Direction)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [enabled])
}

function pressedKey(): Direction | 'a' | 'b' | null {
  for (const pad of navigator.getGamepads()) {
    if (!pad?.connected) continue
    const button = (i: number) => pad.buttons[i]?.pressed === true
    const [x = 0, y = 0] = pad.axes
    if (button(12) || y < -STICK_THRESHOLD) return 'up'
    if (button(13) || y > STICK_THRESHOLD) return 'down'
    if (button(14) || x < -STICK_THRESHOLD) return 'left'
    if (button(15) || x > STICK_THRESHOLD) return 'right'
    if (button(0)) return 'a'
    if (button(1)) return 'b'
  }
  return null
}

function activeElement(): HTMLElement | null {
  const element = document.activeElement
  return element instanceof HTMLElement && element !== document.body ? element : null
}

function navigate(direction: Direction): void {
  const current = activeElement()
  if (current) {
    const event: NavEvent = new CustomEvent(NAV_EVENT, { detail: { direction }, cancelable: true })
    if (!current.dispatchEvent(event)) return
  }
  const next = nearestInDirection(current, direction)
  next?.focus()
}

/** The focusable element closest to `from` in `direction`, favouring alignment. */
function nearestInDirection(from: HTMLElement | null, direction: Direction): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element !== from && element.offsetParent !== null,
  )
  if (!from) return candidates[0] ?? null

  const origin = center(from.getBoundingClientRect())
  let best: { element: HTMLElement; score: number } | null = null
  for (const element of candidates) {
    const target = center(element.getBoundingClientRect())
    const dx = target.x - origin.x
    const dy = target.y - origin.y
    const along = { up: -dy, down: dy, left: -dx, right: dx }[direction]
    if (along <= 1) continue
    const across = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy)
    const score = along + across * 2
    if (!best || score < best.score) best = { element, score }
  }
  return best?.element ?? null
}

function center(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}
