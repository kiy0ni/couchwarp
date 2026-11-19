import { type RefObject, useEffect } from 'react'
import { PadTracker } from './gamepads'
import { KeyboardTracker } from './keyboard'
import type { GuestSession } from './session'

/**
 * How often controllers are read. Browsers refresh gamepad state faster than the screen,
 * so reading once per animation frame would add up to a frame of input delay.
 */
const PAD_POLL_MS = 4

/**
 * Sends this guest's controllers and keyboard to the host while `session` is live.
 * Keys are read on `surface`, which must hold focus; leaving it releases every key.
 */
export function useInputForwarding(
  session: GuestSession | null,
  surface: RefObject<HTMLElement | null>,
  onPadRemoved: (pad: number) => void,
): void {
  useEffect(() => {
    const element = surface.current
    if (!session || !element) return
    const pads = new PadTracker()
    const keyboard = new KeyboardTracker()

    const poll = window.setInterval(() => {
      const now = performance.now()
      const { packets, removed } = pads.poll(navigator.getGamepads(), now)
      for (const packet of packets) session.sendInput(packet)
      for (const pad of removed) {
        session.sendControl({ type: 'pad-removed', pad })
        onPadRemoved(pad)
      }
      const held = keyboard.resend(now)
      if (held) session.sendInput(held)
    }, PAD_POLL_MS)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      // Keys belong to the game: no page scrolling, no browser shortcuts.
      event.preventDefault()
      const packet = keyboard.press(event.code, performance.now())
      if (packet) session.sendInput(packet)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault()
      const packet = keyboard.release(event.code, performance.now())
      if (packet) session.sendInput(packet)
    }
    const releaseAll = () => {
      const packet = keyboard.releaseAll(performance.now())
      if (packet) session.sendInput(packet)
    }

    element.addEventListener('keydown', onKeyDown)
    element.addEventListener('keyup', onKeyUp)
    element.addEventListener('blur', releaseAll)
    element.focus()

    return () => {
      releaseAll()
      window.clearInterval(poll)
      element.removeEventListener('keydown', onKeyDown)
      element.removeEventListener('keyup', onKeyUp)
      element.removeEventListener('blur', releaseAll)
    }
  }, [session, surface, onPadRemoved])
}
