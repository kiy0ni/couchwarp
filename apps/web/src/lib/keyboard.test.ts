import { describe, expect, it } from 'vitest'
import { RESEND_MS } from './gamepads'
import { KeyboardTracker } from './keyboard'

describe('KeyboardTracker', () => {
  it('sends the whole set of held keys on every change', () => {
    const keyboard = new KeyboardTracker()
    expect(keyboard.press('KeyW', 0)?.keys).toEqual([0x1a])
    expect(keyboard.press('ShiftLeft', 1)?.keys).toEqual([0x1a, 0xe1])
    expect(keyboard.release('KeyW', 2)?.keys).toEqual([0xe1])
  })

  it('ignores key repeat and keys outside the protocol', () => {
    const keyboard = new KeyboardTracker()
    keyboard.press('KeyA', 0)
    expect(keyboard.press('KeyA', 30)).toBeNull()
    expect(keyboard.press('MediaPlayPause', 31)).toBeNull()
    expect(keyboard.release('KeyB', 32)).toBeNull()
  })

  it('repeats held keys after the resend delay, and stays quiet when nothing is held', () => {
    const keyboard = new KeyboardTracker()
    expect(keyboard.resend(1000)).toBeNull()
    keyboard.press('Space', 0)
    expect(keyboard.resend(RESEND_MS - 1)).toBeNull()
    expect(keyboard.resend(RESEND_MS)?.keys).toEqual([0x2c])
  })

  it('releases every key at once when the page loses focus', () => {
    const keyboard = new KeyboardTracker()
    keyboard.press('KeyA', 0)
    keyboard.press('KeyD', 0)
    expect(keyboard.releaseAll(5)?.keys).toEqual([])
    expect(keyboard.releaseAll(6)).toBeNull()
  })
})
