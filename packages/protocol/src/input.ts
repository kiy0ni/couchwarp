/**
 * Controller and keyboard state sent on the unreliable `input` data channel.
 * Byte layout and rules: `crates/protocol/src/input.rs`. Only the host decodes these.
 */

export const MAX_KEYS = 32

/** Pad numbers 0 to 3 are physical controllers; the virtual ones come after. */
export const KEYBOARD_PAD = 4
export const TOUCH_PAD = 5

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
  /** 0 to 3 for physical controllers, then `KEYBOARD_PAD` and `TOUCH_PAD`. */
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

export const MouseButton = {
  left: 1 << 0,
  right: 1 << 1,
  middle: 1 << 2,
  back: 1 << 3,
  forward: 1 << 4,
} as const

/**
 * Movement since the previous packet, in pixels; wheel in 1/120ths of a notch, positive
 * down. Buttons are the whole state, so a lost packet never leaves one held.
 */
export interface MousePacket {
  kind: 'mouse'
  seq: number
  buttons: number
  dx: number
  dy: number
  wheel: number
}

export type InputPacket = GamepadPacket | KeyboardPacket | MousePacket

const KIND_GAMEPAD = 1
const KIND_KEYBOARD = 2
const KIND_MOUSE = 3
const GAMEPAD_LENGTH = 16
const MOUSE_LENGTH = 10
const INT16_MIN = -32768
const INT16_MAX = 32767

function int16(value: number): number {
  return Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(value)))
}

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
  if (packet.kind === 'mouse') {
    const view = new DataView(new ArrayBuffer(MOUSE_LENGTH))
    view.setUint8(0, KIND_MOUSE)
    view.setUint16(1, packet.seq, true)
    view.setUint8(3, packet.buttons)
    view.setInt16(4, int16(packet.dx), true)
    view.setInt16(6, int16(packet.dy), true)
    view.setInt16(8, int16(packet.wheel), true)
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
