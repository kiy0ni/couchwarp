import { describe, expect, it } from 'vitest'
import { placeMenu } from './bubble-menu'

const SCREEN = { width: 1280, height: 800 }
const bubble = (left: number, top: number) => ({ left, top, width: 120, height: 40 })

describe('the game menu', () => {
  it('opens below a bubble in the top half', () => {
    expect(placeMenu(bubble(580, 16), SCREEN, 400)).toEqual({
      direction: 'down',
      left: 440,
      offset: 64,
      maxHeight: 724,
    })
  })

  it('opens above a bubble in the bottom half', () => {
    const placement = placeMenu(bubble(580, 700), SCREEN, 400)
    expect(placement.direction).toBe('up')
    // 8 px above the bubble's top edge, counted from the bottom of the screen.
    expect(placement.offset).toBe(108)
    expect(placement.maxHeight).toBe(680)
  })

  it('never runs past the left or right edge', () => {
    expect(placeMenu(bubble(0, 16), SCREEN, 400).left).toBe(12)
    expect(placeMenu(bubble(1160, 700), SCREEN, 400).left).toBe(868)
  })

  it('keeps to the margin on a screen narrower than the menu', () => {
    expect(placeMenu(bubble(100, 16), { width: 360, height: 640 }, 400).left).toBe(12)
  })
})
