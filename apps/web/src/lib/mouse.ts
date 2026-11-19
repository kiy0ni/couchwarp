import { MouseButton, type MousePacket, nextSeq } from '@couchwarp/protocol'
import { RESEND_MS } from './gamepads'

/** `MouseEvent.button` to protocol bits: main, auxiliary (middle), secondary, back, forward. */
const BUTTON_BITS = [
  MouseButton.left,
  MouseButton.middle,
  MouseButton.right,
  MouseButton.back,
  MouseButton.forward,
] as const

/** The protocol counts 120 per wheel notch; browsers report pixels, lines or pages. */
const WHEEL_PER_PIXEL = 1.2
const WHEEL_PER_LINE = 40
const WHEEL_PER_PAGE = 360

/**
 * This guest's mouse while the pointer is locked to the game. Movement and wheel add up
 * between packets; buttons are sent whole, and repeated while held, like keys.
 */
export class MouseTracker {
  private dx = 0
  private dy = 0
  private wheel = 0
  private buttons = 0
  private seq = 0
  private sentAt = 0
  private changed = false

  move(dx: number, dy: number): void {
    this.dx += dx
    this.dy += dy
  }

  press(button: number): void {
    this.setButton(button, true)
  }

  release(button: number): void {
    this.setButton(button, false)
  }

  /** `deltaMode` as in `WheelEvent`: 0 pixels, 1 lines, 2 pages. */
  scroll(deltaY: number, deltaMode: number): void {
    const scale = [WHEEL_PER_PIXEL, WHEEL_PER_LINE, WHEEL_PER_PAGE][deltaMode] ?? WHEEL_PER_PIXEL
    this.wheel += deltaY * scale
  }

  /** Lets go of every button, for when the pointer is unlocked and releases are lost. */
  releaseAll(): void {
    if (this.buttons !== 0) this.changed = true
    this.buttons = 0
  }

  /** The packet to send now: pending movement, a button change, or a repeat while held. */
  packet(now: number): MousePacket | null {
    const moved = Math.round(this.dx) !== 0 || Math.round(this.dy) !== 0
    const scrolled = Math.round(this.wheel) !== 0
    const repeat = this.buttons !== 0 && now - this.sentAt >= RESEND_MS
    if (!moved && !scrolled && !this.changed && !repeat) return null
    this.seq = nextSeq(this.seq)
    this.sentAt = now
    const packet: MousePacket = {
      kind: 'mouse',
      seq: this.seq,
      buttons: this.buttons,
      dx: Math.round(this.dx),
      dy: Math.round(this.dy),
      wheel: Math.round(this.wheel),
    }
    // Sub-pixel remainders carry over, so slow movements are not lost.
    this.dx -= packet.dx
    this.dy -= packet.dy
    this.wheel -= packet.wheel
    this.changed = false
    return packet
  }

  private setButton(button: number, down: boolean): void {
    const bit = BUTTON_BITS[button]
    if (bit === undefined) return
    const next = down ? this.buttons | bit : this.buttons & ~bit
    if (next !== this.buttons) this.changed = true
    this.buttons = next
  }
}
