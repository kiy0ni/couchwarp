import { type GamepadPacket, nextSeq } from '@couchwarp/protocol'
import { RESEND_MS } from './gamepads'
import { NEUTRAL_PAD, type PadState, samePadState } from './pad-state'

/**
 * A controller drawn by software (the keyboard or the touch screen). It sends its state
 * on every change and repeats it while held, like a physical one. It stays silent until
 * first used, so a guest who never touches it does not take a player slot.
 */
export class VirtualPad {
  private last: PadState | null = null
  private seq = 0
  private sentAt = 0

  constructor(private readonly pad: number) {}

  get active(): boolean {
    return this.last !== null
  }

  update(state: PadState, now: number): GamepadPacket | null {
    if (this.last === null && samePadState(state, NEUTRAL_PAD)) return null
    if (this.last && samePadState(this.last, state)) return null
    return this.send(state, now)
  }

  resend(now: number): GamepadPacket | null {
    if (!this.last || samePadState(this.last, NEUTRAL_PAD) || now - this.sentAt < RESEND_MS) {
      return null
    }
    return this.send(this.last, now)
  }

  /** Forgets the pad, so the next use announces it again. */
  reset(): void {
    this.last = null
  }

  private send(state: PadState, now: number): GamepadPacket {
    this.last = state
    this.sentAt = now
    this.seq = nextSeq(this.seq)
    return { kind: 'gamepad', pad: this.pad, seq: this.seq, ...state }
  }
}
