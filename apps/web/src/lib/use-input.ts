import { type InputPacket, KEYBOARD_PAD, nextSeq, TOUCH_PAD } from '@couchwarp/protocol'
import { type RefObject, useEffect, useMemo } from 'react'
import { PadTracker } from './gamepads'
import { KeyboardTracker } from './keyboard'
import { keyboardPadState } from './keyboard-pad'
import { type Motion, motionFor, phoneMotion } from './motion'
import { MouseTracker } from './mouse'
import { NEUTRAL_PAD, type PadState } from './pad-state'
import { preferences } from './preferences'
import type { GuestSession } from './session'
import { VirtualPad } from './virtual-pad'

/**
 * How often controllers are read. Browsers refresh gamepad state faster than the screen,
 * so reading once per animation frame would add up to a frame of input delay.
 */
const PAD_POLL_MS = 4
/** Motion is sent at about the rate a game reads it, not at every sensor report. */
const MOTION_EVERY_MS = 16

/**
 * `keys` sends the keyboard as is; `pad` plays it as a controller; `off` sends nothing,
 * for spectators and for guests the host has not given the keyboard to.
 */
export type KeyboardMode = 'keys' | 'pad' | 'off'

interface Options {
  keyboardMode: KeyboardMode
  /** Current state of the on-screen controller, or null while it is hidden. */
  touch: RefObject<PadState | null>
  /** The host lets this guest's mouse play: a click locks the pointer to the game. */
  mouse: boolean
  onPadRemoved(pad: number): void
  onPointerLock(locked: boolean): void
  /** Couchwarp's own shortcuts, never sent to the game. See `SHORTCUTS`. */
  onShortcut(shortcut: Shortcut): void
}

/**
 * Sends this guest's controllers, keyboard and touch controller to the host while
 * `session` is live. Keys are read on `surface`, which must hold focus; leaving it
 * releases every key.
 */
export function useInputForwarding(
  session: GuestSession | null,
  surface: RefObject<HTMLElement | null>,
  { keyboardMode, touch, mouse: mouseAllowed, onPadRemoved, onPointerLock, onShortcut }: Options,
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
      mouse: new MouseTracker(),
    }),
    [session],
  )

  useEffect(() => {
    const element = surface.current
    if (!session || !element) return
    const { pads, keyboard, keyboardPad, touchPad, mouse } = trackers
    const heldCodes = new Set<string>()

    let motionSeq = 0
    let motionSentAt = 0
    const motionPacket = (pad: number, reading: Motion): InputPacket => {
      motionSeq = nextSeq(motionSeq)
      return { kind: 'motion', pad, seq: motionSeq, gyro: reading.gyro, accel: reading.accel }
    }
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
      const gamepads = navigator.getGamepads()
      const { packets, removed } = pads.poll(gamepads, now)
      for (const packet of packets) session.sendInput(packet)
      for (const pad of removed) removePad(pad)
      if (now - motionSentAt >= MOTION_EVERY_MS) {
        motionSentAt = now
        for (const gamepad of gamepads) {
          const pad = gamepad ? pads.padOf(gamepad.index) : undefined
          const reading = gamepad && pad !== undefined ? motionFor(gamepad, now) : null
          if (reading && pad !== undefined) send(motionPacket(pad, reading))
        }
        const tilt = touch.current ? phoneMotion(now) : null
        if (tilt) send(motionPacket(TOUCH_PAD, tilt))
      }

      if (touch.current) {
        send(touchPad.update(touch.current, now))
      } else if (touchPad.active) {
        send(touchPad.update(NEUTRAL_PAD, now))
        touchPad.reset()
        removePad(TOUCH_PAD)
      }
      send(touchPad.resend(now))
      send(keyboardMode === 'pad' ? keyboardPad.resend(now) : keyboard.resend(now))
      if (mouseAllowed) send(mouse.packet(now))
    }, PAD_POLL_MS)

    // The mouse plays only while the pointer is locked to the game; Escape unlocks it.
    const locked = () => document.pointerLockElement === element
    const onClick = (event: MouseEvent) => {
      // Only a click on the picture itself: the bar and the menus keep their clicks.
      const onPicture = event.target === element || event.target instanceof HTMLVideoElement
      if (mouseAllowed && onPicture && !locked()) {
        element
          .requestPointerLock({ unadjustedMovement: true })
          .catch(() => element.requestPointerLock())
      }
    }
    const onLockChange = () => {
      if (!locked()) mouse.releaseAll()
      onPointerLock(locked())
    }
    const onMouseMove = (event: MouseEvent) => {
      if (!locked()) return
      const speed = preferences().mouseSpeed
      mouse.move(event.movementX * speed, event.movementY * speed)
    }
    const onMouseButton = (event: MouseEvent) => {
      if (!locked()) return
      event.preventDefault()
      if (event.type === 'mousedown') mouse.press(event.button)
      else mouse.release(event.button)
    }
    const onWheel = (event: WheelEvent) => {
      if (!locked()) return
      event.preventDefault()
      mouse.scroll(event.deltaY, event.deltaMode)
    }
    const onContextMenu = (event: Event) => {
      if (locked()) event.preventDefault()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // Typing in the chat or the menu stays there.
      if (event.isComposing || event.target !== element) return
      const shortcut = shortcutOf(event)
      if (shortcut) {
        event.preventDefault()
        onShortcut(shortcut)
        return
      }
      if (keyboardMode === 'off') return
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

    element.addEventListener('click', onClick)
    element.addEventListener('mousemove', onMouseMove)
    element.addEventListener('mousedown', onMouseButton)
    element.addEventListener('mouseup', onMouseButton)
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('pointerlockchange', onLockChange)
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
      if (locked()) document.exitPointerLock()
      mouse.releaseAll()
      send(mouse.packet(performance.now()))
      window.clearInterval(poll)
      element.removeEventListener('click', onClick)
      element.removeEventListener('mousemove', onMouseMove)
      element.removeEventListener('mousedown', onMouseButton)
      element.removeEventListener('mouseup', onMouseButton)
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerlockchange', onLockChange)
      element.removeEventListener('keydown', onKeyDown)
      element.removeEventListener('keyup', onKeyUp)
      element.removeEventListener('blur', releaseAll)
    }
  }, [
    session,
    surface,
    keyboardMode,
    touch,
    mouseAllowed,
    onPadRemoved,
    onPointerLock,
    onShortcut,
    trackers,
  ])
}

export type Shortcut = 'menu' | 'chat' | 'fullscreen'

/** Ctrl and Shift together with a letter: a combination games almost never use. */
export const SHORTCUTS: Record<Shortcut, string> = {
  menu: 'KeyM',
  chat: 'KeyC',
  fullscreen: 'KeyF',
}

function shortcutOf(event: KeyboardEvent): Shortcut | null {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return null
  const found = Object.entries(SHORTCUTS).find(([, code]) => code === event.code)
  return found ? (found[0] as Shortcut) : null
}
