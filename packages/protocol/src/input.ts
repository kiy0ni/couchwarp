/**
 * Controller and keyboard state sent on the unreliable `input` data channel.
 * Byte layout and rules: `crates/protocol/src/input.rs`. Only the host decodes these.
 */

export const MAX_KEYS = 32

/** Bits of `GamepadPacket.buttons`, in W3C standard mapping order without the triggers. */
export const Button = {
  a: 1 << 0,
  b: 1 << 1,
  x: 1 << 2,
  y: 1 << 3,
  leftBumper: 1 << 4,
  rightBumper: 1 << 5,
  back: 1 << 6,
  start: 1 << 7,
  leftStick: 1 << 8,
  rightStick: 1 << 9,
  dpadUp: 1 << 10,
  dpadDown: 1 << 11,
  dpadLeft: 1 << 12,
  dpadRight: 1 << 13,
  guide: 1 << 14,
} as const

export interface GamepadPacket {
  kind: 'gamepad'
  /** Controller index on the guest's device, 0 to 3. */
  pad: number
  seq: number
  buttons: number
  /** Stick axes from -32768 to 32767. Y is positive downwards, as in the Gamepad API. */
  leftStick: readonly [number, number]
  rightStick: readonly [number, number]
  /** 0 to 255. */
  leftTrigger: number
  rightTrigger: number
}

export interface KeyboardPacket {
  kind: 'keyboard'
  seq: number
  /** USB HID usage IDs (keyboard page) of every key held. */
  keys: readonly number[]
}

export type InputPacket = GamepadPacket | KeyboardPacket

const KIND_GAMEPAD = 1
const KIND_KEYBOARD = 2
const GAMEPAD_LENGTH = 16

export function encodeInput(packet: InputPacket): Uint8Array<ArrayBuffer> {
  if (packet.kind === 'gamepad') {
    const view = new DataView(new ArrayBuffer(GAMEPAD_LENGTH))
    view.setUint8(0, KIND_GAMEPAD)
    view.setUint8(1, packet.pad)
    view.setUint16(2, packet.seq, true)
    view.setUint16(4, packet.buttons, true)
    view.setInt16(6, packet.leftStick[0], true)
    view.setInt16(8, packet.leftStick[1], true)
    view.setInt16(10, packet.rightStick[0], true)
    view.setInt16(12, packet.rightStick[1], true)
    view.setUint8(14, packet.leftTrigger)
    view.setUint8(15, packet.rightTrigger)
    return new Uint8Array(view.buffer)
  }
  const keys = packet.keys.slice(0, MAX_KEYS)
  const bytes = new Uint8Array(4 + keys.length)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, KIND_KEYBOARD)
  view.setUint16(1, packet.seq, true)
  view.setUint8(3, keys.length)
  bytes.set(keys, 4)
  return bytes
}

/** Next value of a 16-bit sequence counter. */
export function nextSeq(seq: number): number {
  return (seq + 1) & 0xffff
}
