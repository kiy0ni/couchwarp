import { type KeyboardPacket, MAX_KEYS, nextSeq } from '@couchwarp/protocol'
import { RESEND_MS } from './gamepads'
import { hidUsage } from './keymap'

/**
 * The set of keys held by this guest. Every change produces a packet with the full set;
 * while keys stay held, `resend` repeats it so a lost packet cannot leave a key stuck.
 */
export class KeyboardTracker {
  private held = new Set<number>()
  private seq = 0
  private sentAt = 0

  /** Returns the packet to send, or null when the key is not carried or nothing changed. */
  press(code: string, now: number): KeyboardPacket | null {
    const usage = hidUsage(code)
    if (usage === undefined || this.held.has(usage) || this.held.size >= MAX_KEYS) return null
    this.held.add(usage)
    return this.packet(now)
  }

  release(code: string, now: number): KeyboardPacket | null {
    const usage = hidUsage(code)
    if (usage === undefined || !this.held.delete(usage)) return null
    return this.packet(now)
  }

  /** Releases everything, for when the page loses focus and key-ups will never arrive. */
  releaseAll(now: number): KeyboardPacket | null {
    if (this.held.size === 0) return null
    this.held.clear()
    return this.packet(now)
  }

  resend(now: number): KeyboardPacket | null {
    if (this.held.size === 0 || now - this.sentAt < RESEND_MS) return null
    return this.packet(now)
  }

  private packet(now: number): KeyboardPacket {
    this.seq = nextSeq(this.seq)
    this.sentAt = now
    return { kind: 'keyboard', seq: this.seq, keys: [...this.held] }
  }
}
