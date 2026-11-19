import { type InputPacket, KEYBOARD_PAD, TOUCH_PAD } from '@couchwarp/protocol'
import { type RefObject, useEffect, useMemo } from 'react'
import { PadTracker } from './gamepads'
import { KeyboardTracker } from './keyboard'
import { keyboardPadState } from './keyboard-pad'
import { NEUTRAL_PAD, type PadState } from './pad-state'
import type { GuestSession } from './session'
import { VirtualPad } from './virtual-pad'

/**
 * How often controllers are read. Browsers refresh gamepad state faster than the screen,
 * so reading once per animation frame would add up to a frame of input delay.
 */
const PAD_POLL_MS = 4

/**
 * `keys` sends the keyboard as is; `pad` plays it as a controller; `off` sends nothing,
 * for spectators and for guests the host has not given the keyboard to.
 */
export type KeyboardMode = 'keys' | 'pad' | 'off'

interface Options {
  keyboardMode: KeyboardMode
  /** Current state of the on-screen controller, or null while it is hidden. */
  touch: RefObject<PadState | null>
  onPadRemoved(pad: number): void
}

/**
 * Sends this guest's controllers, keyboard and touch controller to the host while
 * `session` is live. Keys are read on `surface`, which must hold focus; leaving it
 * releases every key.
 */
export function useInputForwarding(
  session: GuestSession | null,
  surface: RefObject<HTMLElement | null>,
  { keyboardMode, touch, onPadRemoved }: Options,
): void {
  // One set of trackers per session: their sequence numbers must keep rising across
  // keyboard mode changes, or the host would take the next packets for late ones.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new session starts fresh
  const trackers = useMemo(
    () => ({
      pads: new PadTracker(),
      keyboard: new KeyboardTracker(),
      keyboardPad: new VirtualPad(KEYBOARD_PAD),
      touchPad: new VirtualPad(TOUCH_PAD),
    }),
    [session],
  )

  useEffect(() => {
    const element = surface.current
    if (!session || !element) return
    const { pads, keyboard, keyboardPad, touchPad } = trackers
    const heldCodes = new Set<string>()

    const send = (packet: InputPacket | null) => {
      if (packet) session.sendInput(packet)
    }
    const removePad = (pad: number) => {
      session.sendControl({ type: 'pad-removed', pad })
      onPadRemoved(pad)
    }
    const playKeys = (now: number) => {
      if (keyboardMode === 'pad') send(keyboardPad.update(keyboardPadState(heldCodes), now))
    }

    const poll = window.setInterval(() => {
      const now = performance.now()
      const { packets, removed } = pads.poll(navigator.getGamepads(), now)
      for (const packet of packets) session.sendInput(packet)
      for (const pad of removed) removePad(pad)

      if (touch.current) {
        send(touchPad.update(touch.current, now))
      } else if (touchPad.active) {
        send(touchPad.update(NEUTRAL_PAD, now))
        touchPad.reset()
        removePad(TOUCH_PAD)
      }
      send(touchPad.resend(now))
      send(keyboardMode === 'pad' ? keyboardPad.resend(now) : keyboard.resend(now))
    }, PAD_POLL_MS)

    const onKeyDown = (event: KeyboardEvent) => {
      // Typing in the chat or the menu stays there.
      if (event.isComposing || event.target !== element || keyboardMode === 'off') return
      // Keys belong to the game: no page scrolling, no browser shortcuts.
      event.preventDefault()
      const now = performance.now()
      heldCodes.add(event.code)
      if (keyboardMode === 'keys') send(keyboard.press(event.code, now))
      else playKeys(now)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.target !== element || keyboardMode === 'off') return
      event.preventDefault()
      const now = performance.now()
      heldCodes.delete(event.code)
      if (keyboardMode === 'keys') send(keyboard.release(event.code, now))
      else playKeys(now)
    }
    const releaseAll = () => {
      const now = performance.now()
      heldCodes.clear()
      send(keyboard.releaseAll(now))
      playKeys(now)
    }

    element.addEventListener('keydown', onKeyDown)
    element.addEventListener('keyup', onKeyUp)
    element.addEventListener('blur', releaseAll)
    element.focus()

    return () => {
      releaseAll()
      if (keyboardPad.active) {
        keyboardPad.reset()
        removePad(KEYBOARD_PAD)
      }
      window.clearInterval(poll)
      element.removeEventListener('keydown', onKeyDown)
      element.removeEventListener('keyup', onKeyUp)
      element.removeEventListener('blur', releaseAll)
    }
  }, [session, surface, keyboardMode, touch, onPadRemoved, trackers])
}
