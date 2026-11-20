import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { setPreferences, usePreferences } from '../lib/preferences'

/** Past this many pixels, a press on the bubble moves it instead of opening the menu. */
const DRAG_THRESHOLD = 6
/** The bubble fades after this long without the pointer near it. */
const FADE_AFTER_MS = 2500

interface Props {
  /** Player lights, latency, turn timer: what the bubble shows at a glance. */
  children: ReactNode
  /** Messages waiting while the chat is closed. */
  unread: number
  /** Keeps the bubble bright, for notices the guest must see. */
  attention: boolean
  onOpen(): void
  /** After a move, so the keyboard goes back to the game. */
  onMoved(): void
}

/**
 * The game's only control on screen: a small bubble the guest can drag anywhere. It fades
 * while playing and opens the menu when pressed, so the picture keeps the whole screen.
 */
export function GameBubble({ children, unread, attention, onOpen, onMoved }: Props) {
  const { bubble } = usePreferences()
  const element = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  /** Set when a drag just ended, so the click that follows does not open the menu. */
  const dragged = useRef(false)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const [faded, setFaded] = useState(false)
  const fadeTimer = useRef(0)

  const wake = () => {
    setFaded(false)
    window.clearTimeout(fadeTimer.current)
    fadeTimer.current = window.setTimeout(() => setFaded(true), FADE_AFTER_MS)
  }
  useEffect(() => {
    fadeTimer.current = window.setTimeout(() => setFaded(true), FADE_AFTER_MS)
    return () => window.clearTimeout(fadeTimer.current)
  }, [])

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, moved: false }
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    wake()
    const start = drag.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    start.moved = true
    setOffset({ x: dx, y: dy })
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current
    drag.current = null
    setOffset(null)
    if (!start?.moved) return
    dragged.current = true
    // Saved as a share of the screen, so it lands in the same place at any size.
    const box = element.current?.getBoundingClientRect()
    if (!box) return
    const x = (box.left + box.width / 2) / window.innerWidth
    const y = box.top / window.innerHeight
    setPreferences({ bubble: { x: clamp(x, 0.05, 0.95), y: clamp(y, 0, 0.92) } })
    event.preventDefault()
    onMoved()
  }

  return (
    <button
      ref={element}
      type="button"
      className="bubble"
      data-faded={faded && !attention && offset === null ? true : undefined}
      data-dragging={offset ? true : undefined}
      style={{
        left: `${bubble.x * 100}%`,
        top: `${bubble.y * 100}%`,
        transform: `translate(calc(-50% + ${offset?.x ?? 0}px), ${offset?.y ?? 0}px)`,
      }}
      aria-label={unread > 0 ? t.play.bubbleUnread(unread) : t.play.bubble}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={wake}
      onFocus={wake}
      onClick={() => {
        // A drag ends with a click event too; only a press opens the menu.
        if (dragged.current) dragged.current = false
        else onOpen()
      }}
    >
      <span className="bubble__grip" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {children}
      {unread > 0 && (
        <span className="count" aria-hidden="true">
          {unread}
        </span>
      )}
    </button>
  )
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
