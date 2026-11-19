import { Button } from '@couchwarp/protocol'
import { describe, expect, it } from 'vitest'
import { keyboardPadState } from './keyboard-pad'

const held = (...codes: string[]) => new Set(codes)

describe('keyboardPadState', () => {
  it('turns WASD into the left stick, Y pointing down as in the Gamepad API', () => {
    expect(keyboardPadState(held('KeyW')).leftStick).toEqual([0, -32767])
    expect(keyboardPadState(held('KeyD')).leftStick).toEqual([32767, 0])
  })

  it('keeps diagonals on the stick circle', () => {
    const [x, y] = keyboardPadState(held('KeyW', 'KeyD')).leftStick
    expect(x).toBe(23170)
    expect(y).toBe(-23170)
  })

  it('cancels opposite directions', () => {
    expect(keyboardPadState(held('KeyA', 'KeyD')).leftStick).toEqual([0, 0])
  })

  it('maps face buttons, triggers and menu keys', () => {
    const state = keyboardPadState(held('KeyK', 'KeyI', 'KeyU', 'Enter'))
    expect(state.buttons).toBe(Button.a | Button.y | Button.start)
    expect(state.rightTrigger).toBe(255)
    expect(state.leftTrigger).toBe(0)
  })

  it('ignores keys outside the layout', () => {
    expect(keyboardPadState(held('KeyZ', 'Digit1')).buttons).toBe(0)
  })
})
