import { describe, expect, it } from 'vitest'
import { RESEND_MS } from './gamepads'
import { NEUTRAL_PAD } from './pad-state'
import { VirtualPad } from './virtual-pad'

const pressed = { ...NEUTRAL_PAD, buttons: 1 }

describe('VirtualPad', () => {
  it('stays silent until first used, so it takes no player slot', () => {
    const pad = new VirtualPad(4)
    expect(pad.update(NEUTRAL_PAD, 0)).toBeNull()
    expect(pad.resend(1000)).toBeNull()
    expect(pad.active).toBe(false)
  })

  it('sends changes, including the release back to neutral', () => {
    const pad = new VirtualPad(5)
    expect(pad.update(pressed, 0)).toMatchObject({ kind: 'gamepad', pad: 5, seq: 1, buttons: 1 })
    expect(pad.update(pressed, 5)).toBeNull()
    expect(pad.update(NEUTRAL_PAD, 10)).toMatchObject({ seq: 2, buttons: 0 })
  })

  it('repeats a held state but not a neutral one', () => {
    const pad = new VirtualPad(4)
    pad.update(pressed, 0)
    expect(pad.resend(RESEND_MS - 1)).toBeNull()
    expect(pad.resend(RESEND_MS)).toMatchObject({ buttons: 1 })
    pad.update(NEUTRAL_PAD, RESEND_MS + 1)
    expect(pad.resend(10 * RESEND_MS)).toBeNull()
  })

  it('announces itself again after a reset', () => {
    const pad = new VirtualPad(4)
    pad.update(pressed, 0)
    pad.reset()
    expect(pad.active).toBe(false)
    expect(pad.update(pressed, 1)).not.toBeNull()
  })
})
