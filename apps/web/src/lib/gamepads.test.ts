import { Button } from '@couchwarp/protocol'
import { describe, expect, it } from 'vitest'
import { PadTracker, RESEND_MS, readGamepad } from './gamepads'

function fakeGamepad(index: number, pressed: number[] = [], axes = [0, 0, 0, 0]): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.includes(i),
    touched: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  }))
  return { index, connected: true, axes, buttons, mapping: 'standard' } as unknown as Gamepad
}

describe('readGamepad', () => {
  it('maps standard buttons to protocol bits and triggers to 0 to 255', () => {
    const state = readGamepad(fakeGamepad(0, [0, 7, 9, 16], [1, -1, 0.5, 2]), 2)
    expect(state.buttons).toBe(Button.a | Button.start | Button.guide)
    expect(state.rightTrigger).toBe(255)
    expect(state.leftTrigger).toBe(0)
    expect(state.leftStick).toEqual([32767, -32767])
    expect(state.rightStick).toEqual([16384, 32767])
    expect(state.pad).toBe(2)
  })
})

describe('PadTracker', () => {
  it('sends a state when it changes, and again after the resend delay', () => {
    const tracker = new PadTracker()
    expect(tracker.poll([fakeGamepad(0)], 0).packets).toHaveLength(1)
    expect(tracker.poll([fakeGamepad(0)], 10).packets).toHaveLength(0)
    expect(tracker.poll([fakeGamepad(0, [0])], 20).packets).toHaveLength(1)
    expect(tracker.poll([fakeGamepad(0, [0])], 20 + RESEND_MS).packets).toHaveLength(1)
  })

  it('numbers packets with a rising sequence', () => {
    const tracker = new PadTracker()
    const first = tracker.poll([fakeGamepad(0)], 0).packets[0]
    const second = tracker.poll([fakeGamepad(0, [1])], 1).packets[0]
    expect(second?.seq).toBe((first?.seq ?? 0) + 1)
  })

  it('keeps pad numbers stable and reuses the slot of a removed controller', () => {
    const tracker = new PadTracker()
    tracker.poll([fakeGamepad(3), fakeGamepad(5)], 0)
    const afterRemoval = tracker.poll([null, fakeGamepad(5)], 1)
    expect(afterRemoval.removed).toEqual([0])
    const next = tracker.poll([fakeGamepad(5), fakeGamepad(9)], 2 + RESEND_MS)
    expect(next.packets.map((p) => p.pad).sort()).toEqual([0, 1])
  })

  it('ignores a fifth controller', () => {
    const tracker = new PadTracker()
    const pads = [0, 1, 2, 3, 4].map((i) => fakeGamepad(i))
    expect(tracker.poll(pads, 0).packets).toHaveLength(4)
  })
})
