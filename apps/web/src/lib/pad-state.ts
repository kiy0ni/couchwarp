import type { GamepadPacket } from '@couchwarp/protocol'

/** What a controller is doing, without the addressing (`pad`, `seq`) of a packet. */
export type PadState = Pick<
  GamepadPacket,
  'buttons' | 'leftStick' | 'rightStick' | 'leftTrigger' | 'rightTrigger'
>

export const NEUTRAL_PAD: PadState = {
  buttons: 0,
  leftStick: [0, 0],
  rightStick: [0, 0],
  leftTrigger: 0,
  rightTrigger: 0,
}

export function samePadState(a: PadState, b: PadState): boolean {
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
