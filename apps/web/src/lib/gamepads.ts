import { Button, type GamepadPacket, nextSeq } from '@couchwarp/protocol'

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

function axis(value: number | undefined): number {
  return Math.round(Math.max(-1, Math.min(1, value ?? 0)) * 32767)
}

function trigger(button: GamepadButton | undefined): number {
  return Math.round((button?.value ?? 0) * 255)
}

/** State of one controller, with `seq` left at 0 for the caller to fill. */
export function readGamepad(gamepad: Gamepad, pad: number): GamepadPacket {
  let buttons = 0
  for (const [index, bit] of BUTTON_BITS) {
    if (gamepad.buttons[index]?.pressed) buttons |= bit
  }
  return {
    kind: 'gamepad',
    pad,
    seq: 0,
    buttons,
    leftStick: [axis(gamepad.axes[0]), axis(gamepad.axes[1])],
    rightStick: [axis(gamepad.axes[2]), axis(gamepad.axes[3])],
    leftTrigger: trigger(gamepad.buttons[6]),
    rightTrigger: trigger(gamepad.buttons[7]),
  }
}

function sameState(a: GamepadPacket, b: GamepadPacket): boolean {
  return (
    a.buttons === b.buttons &&
    a.leftStick[0] === b.leftStick[0] &&
    a.leftStick[1] === b.leftStick[1] &&
    a.rightStick[0] === b.rightStick[0] &&
    a.rightStick[1] === b.rightStick[1] &&
    a.leftTrigger === b.leftTrigger &&
    a.rightTrigger === b.rightTrigger
  )
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
      const state = readGamepad(gamepad, pad)
      const tracked = this.pads[pad]
      if (tracked && sameState(tracked.last, state) && now - tracked.sentAt < RESEND_MS) continue
      this.seq = nextSeq(this.seq)
      const packet = { ...state, seq: this.seq }
      this.pads[pad] = { index: gamepad.index, last: packet, sentAt: now }
      packets.push(packet)
    }
    return { packets, removed }
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
