import { describe, expect, it } from 'vitest'
import { applyLayout, DEFAULT_LAYOUT, isCustom, layoutKey, remap, stick } from './pad-layout'

function pad(pressed: number[], axes = [0, 0, 0, 0]): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  }))
  return { id: 'Xbox (Vendor: 045e Product: 028e)', axes, buttons } as unknown as Gamepad
}

describe('controller layouts', () => {
  it('changes nothing out of the box', () => {
    const logical = applyLayout(pad([0, 7], [0.3, -0.2, 1, 0]), DEFAULT_LAYOUT)
    expect(logical.buttons[0]?.pressed).toBe(true)
    expect(logical.buttons[7]?.value).toBe(1)
    expect(logical.axes).toEqual([0.3, -0.2, 1, 0])
    expect(isCustom(DEFAULT_LAYOUT)).toBe(false)
  })

  it('plays a game button with another physical button', () => {
    // The game's A (0) comes from the physical right bumper (5).
    const layout = remap(DEFAULT_LAYOUT, 0, 5)
    expect(applyLayout(pad([5]), layout).buttons[0]?.pressed).toBe(true)
    expect(applyLayout(pad([0]), layout).buttons[0]?.pressed).toBe(false)
    // Mapping a button back to itself removes the change.
    expect(isCustom(remap(layout, 0, 0))).toBe(false)
  })

  it('centres a stick inside the dead zone and stretches the rest', () => {
    expect(stick(0.05, 0.05, 0.1)).toEqual([0, 0])
    const [x] = stick(0.55, 0, 0.1)
    expect(x).toBeCloseTo(0.5)
    expect(stick(1, 0, 0.1)).toEqual([1, 0])
  })

  it('inverts and swaps sticks', () => {
    const layout = { ...DEFAULT_LAYOUT, swapSticks: true, invertRightY: true }
    expect(applyLayout(pad([], [0.1, 0.2, 0.3, 0.4]), layout).axes).toEqual([0.3, 0.4, 0.1, -0.2])
  })

  it('keeps one layout per controller model', () => {
    expect(layoutKey({ id: 'Wireless Controller (Vendor: 054c Product: 09cc)' })).toBe('054c:09cc')
    expect(layoutKey({ id: 'DUALSHOCK 4 Wireless Controller' })).toBe(
      'DUALSHOCK 4 Wireless Controller',
    )
  })
})
