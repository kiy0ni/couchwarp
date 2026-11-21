/**
 * JSON messages between the host and one guest on the reliable `control` data channel.
 * Rust side and field meanings: `crates/protocol/src/control.rs`.
 */

import { isFiniteNumber, isInteger, parseObject } from './validate'

export type GuestControl =
  | { type: 'ping'; t0: number }
  | { type: 'pad-removed'; pad: number }
  /** Every second: video packets lost in thousandths, and the 95th percentile latency. */
  | { type: 'quality'; lossPermille: number; latencyMs: number | null }

export type HostControl =
  | { type: 'host-info'; virtualPads: boolean }
  | { type: 'pong'; t0: number; t1: number }
  | { type: 'stream-clock'; epochMs: number }
  | { type: 'slot'; pad: number; slot: number }
  | { type: 'input-paused'; paused: boolean }
  /** The game closed on the host's computer; the room waits for it to come back. */
  | { type: 'game-closed'; closed: boolean }

export function parseHostControl(text: string): HostControl | null {
  const message = parseObject(text)
  switch (message?.type) {
    case 'host-info':
      return typeof message.virtualPads === 'boolean'
        ? { type: 'host-info', virtualPads: message.virtualPads }
        : null
    case 'pong':
      return isFiniteNumber(message.t0) && isFiniteNumber(message.t1)
        ? { type: 'pong', t0: message.t0, t1: message.t1 }
        : null
    case 'stream-clock':
      return isFiniteNumber(message.epochMs)
        ? { type: 'stream-clock', epochMs: message.epochMs }
        : null
    case 'slot':
      return isInteger(message.pad, 0, 5) && isInteger(message.slot, 1, 8)
        ? { type: 'slot', pad: message.pad, slot: message.slot }
        : null
    case 'input-paused':
      return typeof message.paused === 'boolean'
        ? { type: 'input-paused', paused: message.paused }
        : null
    case 'game-closed':
      return typeof message.closed === 'boolean'
        ? { type: 'game-closed', closed: message.closed }
        : null
    default:
      return null
  }
}
