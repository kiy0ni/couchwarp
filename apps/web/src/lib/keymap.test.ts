import { describe, expect, it } from 'vitest'
import { hidUsage } from './keymap'

// Expected values come from the USB HID Usage Tables, keyboard page (0x07).
describe('hidUsage', () => {
  it.each([
    ['KeyA', 0x04],
    ['KeyW', 0x1a],
    ['KeyZ', 0x1d],
    ['Digit1', 0x1e],
    ['Digit9', 0x26],
    ['Digit0', 0x27],
    ['F1', 0x3a],
    ['F12', 0x45],
    ['Numpad1', 0x59],
    ['Numpad9', 0x61],
    ['Numpad0', 0x62],
    ['Space', 0x2c],
    ['ArrowUp', 0x52],
    ['ShiftLeft', 0xe1],
    ['MetaRight', 0xe7],
  ])('maps %s to %i', (code, usage) => {
    expect(hidUsage(code)).toBe(usage)
  })

  it('ignores keys the protocol does not carry', () => {
    expect(hidUsage('F13')).toBeUndefined()
    expect(hidUsage('MediaPlayPause')).toBeUndefined()
    expect(hidUsage('')).toBeUndefined()
  })
})
