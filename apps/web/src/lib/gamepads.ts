import { Button, type GamepadPacket, nextSeq } from '@couchwarp/protocol'
import { familyOf } from './controllers'
import { applyLayout, DEFAULT_LAYOUT, layoutFor, type PadLayout } from './pad-layout'
import { samePadState } from './pad-state'
import { preferences } from './preferences'

/** Most controllers one guest can bring. */
export const MAX_PADS = 4
/** A state is sent again this often even when nothing changed, to make up for lost packets. */
export const RESEND_MS = 100

// Index of each button in the W3C standard mapping. Buttons 6 and 7 are the analog triggers.
const BUTTON_BITS: readonly (readonly [index: number, bit: number])[] = [
  [0, Button.a],
  [1, Button.b],
  [2, Button.x],
  [3, Button.y],
  [4, Button.leftBumper],
  [5, Button.rightBumper],
  [8, Button.back],
  [9, Button.start],
  [10, Button.leftStick],
  [11, Button.rightStick],
  [12, Button.dpadUp],
  [13, Button.dpadDown],
  [14, Button.dpadLeft],
  [15, Button.dpadRight],
  [16, Button.guide],
]

function axis(value: number): number {
  return Math.round(value * 32767)
}

function trigger(button: { value: number } | undefined): number {
  return Math.round((button?.value ?? 0) * 255)
}

/**
 * State of one controller, with `seq` left at 0 for the caller to fill, once its `layout`
 * (remapping, dead zone) is applied. With `byLetters`, a Nintendo controller's face
 * buttons follow their letters instead of their places.
 */
export function readGamepad(
  gamepad: Gamepad,
  pad: number,
  byLetters = false,
  layout: PadLayout = DEFAULT_LAYOUT,
): GamepadPacket {
  const logical = applyLayout(gamepad, layout)
  let buttons = 0
  for (const [index, bit] of BUTTON_BITS) {
    if (logical.buttons[index]?.pressed) buttons |= bit
  }
  if (byLetters && familyOf(gamepad.id ?? '') === 'nintendo') buttons = swapFaceLetters(buttons)
  const [leftX, leftY, rightX, rightY] = logical.axes
  return {
    kind: 'gamepad',
    pad,
    seq: 0,
    buttons,
    leftStick: [axis(leftX), axis(leftY)],
    rightStick: [axis(rightX), axis(rightY)],
    leftTrigger: trigger(logical.buttons[6]),
    rightTrigger: trigger(logical.buttons[7]),
  }
}

/** A with B, X with Y: the game's A becomes the button printed A on a Nintendo pad. */
export function swapFaceLetters(buttons: number): number {
  const swap = (bits: number, one: number, other: number) => {
    const hasOne = (bits & one) !== 0
    const hasOther = (bits & other) !== 0
    let out = bits & ~(one | other)
    if (hasOne) out |= other
    if (hasOther) out |= one
    return out
  }
  return swap(swap(buttons, Button.a, Button.b), Button.x, Button.y)
}

interface Tracked {
  /** `Gamepad.index`, stable while the controller stays connected. */
  index: number
  last: GamepadPacket
  sentAt: number
}

/**
 * Gives each connected controller a pad number from 0 to 3 and decides when its state
 * must be sent: on any change, and every `RESEND_MS` otherwise.
 */
export class PadTracker {
  private pads: (Tracked | undefined)[] = []
  private seq = 0

  poll(
    gamepads: readonly (Gamepad | null)[],
    now: number,
  ): { packets: GamepadPacket[]; removed: number[] } {
    const connected = gamepads.filter((g): g is Gamepad => g?.connected === true)
    const removed = this.forgetDisconnected(connected)
    const packets: GamepadPacket[] = []

    for (const gamepad of connected) {
      const pad = this.padFor(gamepad.index)
      if (pad === undefined) continue
      const state = readGamepad(gamepad, pad, preferences().nintendoLetters, layoutFor(gamepad))
      const tracked = this.pads[pad]
      if (tracked && samePadState(tracked.last, state) && now - tracked.sentAt < RESEND_MS) continue
      this.seq = nextSeq(this.seq)
      const packet = { ...state, seq: this.seq }
      this.pads[pad] = { index: gamepad.index, last: packet, sentAt: now }
      packets.push(packet)
    }
    return { packets, removed }
  }

  /** The pad number of a connected controller, by its `Gamepad.index`. */
  padOf(index: number): number | undefined {
    const pad = this.pads.findIndex((tracked) => tracked?.index === index)
    return pad === -1 ? undefined : pad
  }

  private padFor(index: number): number | undefined {
    const known = this.pads.findIndex((tracked) => tracked?.index === index)
    if (known !== -1) return known
    for (let pad = 0; pad < MAX_PADS; pad++) {
      if (!this.pads[pad]) return pad
    }
    return undefined
  }

  private forgetDisconnected(connected: readonly Gamepad[]): number[] {
    const removed: number[] = []
    this.pads.forEach((tracked, pad) => {
      if (tracked && !connected.some((g) => g.index === tracked.index)) {
        this.pads[pad] = undefined
        removed.push(pad)
      }
    })
    return removed
  }
}

/** The controller's name, without the vendor and product numbers browsers add. */
export function padName(gamepad: Pick<Gamepad, 'id'>): string {
  return gamepad.id.replace(/\s*\(.*\)\s*$/, '').trim() || 'Controller'
}
