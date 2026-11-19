import { MouseButton } from '@couchwarp/protocol'
import { describe, expect, it } from 'vitest'
import { MouseTracker } from './mouse'

describe('MouseTracker', () => {
  it('adds movement up between packets and keeps the remainders', () => {
    const mouse = new MouseTracker()
    mouse.move(2.4, -1)
    mouse.move(1.4, 0)
    expect(mouse.packet(0)).toMatchObject({ dx: 4, dy: -1, buttons: 0 })
    // 3.8 went out as 4: the next 1.0 lands on 0.8, sent as 1.
    mouse.move(1, 0)
    expect(mouse.packet(1)).toMatchObject({ dx: 1 })
    expect(mouse.packet(2)).toBeNull()
  })

  it('sends buttons whole, and repeats them while held', () => {
    const mouse = new MouseTracker()
    mouse.press(0)
    mouse.press(2)
    expect(mouse.packet(0)?.buttons).toBe(MouseButton.left | MouseButton.right)
    expect(mouse.packet(10)).toBeNull()
    expect(mouse.packet(200)?.buttons).toBe(MouseButton.left | MouseButton.right)
    mouse.releaseAll()
    expect(mouse.packet(201)?.buttons).toBe(0)
  })

  it('turns wheel pixels and lines into notches of 120', () => {
    const mouse = new MouseTracker()
    mouse.scroll(100, 0)
    expect(mouse.packet(0)?.wheel).toBe(120)
    mouse.scroll(-3, 1)
    expect(mouse.packet(1)?.wheel).toBe(-120)
  })
})
