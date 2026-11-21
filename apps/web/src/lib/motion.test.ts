import { afterEach, describe, expect, it, vi } from 'vitest'
import { addReport, motionFor } from './motion'

const SONY = 0x054c
const DS4 = 0x09cc
const DUALSENSE = 0x0ce6

/** A report body (after its id) with the gyro and accelerometer at `offset`. */
function report(length: number, offset: number, values: number[]): DataView {
  const view = new DataView(new ArrayBuffer(length))
  for (const [index, value] of values.entries()) view.setInt16(offset + index * 2, value, true)
  return view
}

function pad(id: string): Gamepad {
  return { id } as Gamepad
}

afterEach(() => vi.useRealTimers())

describe('controller motion', () => {
  it('reads a DualShock 4 over USB and over Bluetooth at their own offsets', () => {
    const now = performance.now()
    addReport(SONY, DS4, 0x01, report(64, 12, [1, 2, 3, 4, 5, 6]))
    const chrome = pad('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')
    expect(motionFor(chrome, now)).toMatchObject({ gyro: [1, 2, 3], accel: [4, 5, 6] })
    addReport(SONY, DS4, 0x11, report(77, 14, [7, 8, 9, 10, 11, 12]))
    expect(motionFor(chrome, now)).toMatchObject({ gyro: [7, 8, 9], accel: [10, 11, 12] })
  })

  it('reads a DualSense over Bluetooth one byte further', () => {
    const now = performance.now()
    addReport(SONY, DUALSENSE, 0x31, report(77, 16, [-1, -2, -3, 8192, 0, 0]))
    const firefox = pad('054c-0ce6-DualSense Wireless Controller')
    expect(motionFor(firefox, now)).toMatchObject({ gyro: [-1, -2, -3], accel: [8192, 0, 0] })
  })

  it('finds the reading for a controller WebKit names without ids, only when one fits', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const webkit = pad('DUALSHOCK 4 Wireless Controller')
    addReport(SONY, DS4, 0x01, report(64, 12, [1, 1, 1, 0, 0, 0]))
    addReport(SONY, DUALSENSE, 0x01, report(64, 15, [2, 2, 2, 0, 0, 0]))
    // Two Sony controllers report: no guess between them.
    expect(motionFor(webkit, performance.now())).toBeNull()
    vi.advanceTimersByTime(200)
    addReport(SONY, DS4, 0x01, report(64, 12, [3, 3, 3, 0, 0, 0]))
    expect(motionFor(webkit, performance.now())).toMatchObject({ gyro: [3, 3, 3] })
    expect(motionFor(pad('Xbox Wireless Controller'), performance.now())).toBeNull()
  })

  it('forgets a controller that stopped reporting', () => {
    const now = performance.now()
    addReport(SONY, DS4, 0x01, report(64, 12, [1, 2, 3, 4, 5, 6]))
    const chrome = pad('Vendor: 054c Product: 09cc')
    expect(motionFor(chrome, now + 500)).toBeNull()
  })

  it('turns a Switch controller’s axes into a DualShock’s', () => {
    const now = performance.now()
    // Switch axes: forward, left, up. Lying flat and turning left (around "up").
    addReport(0x057e, 0x2009, 0x30, report(48, 12, [0, 0, 4096, 0, 0, 1000]))
    const motion = motionFor(pad('Pro Controller (Vendor: 057e Product: 2009)'), now)
    // DualShock axes: right, up, towards the player. Gravity up, the turn around "up".
    expect(motion?.accel).toEqual([-0, 8192, -0])
    expect(motion?.gyro.map(Math.round)).toEqual([-0, 1150, -0])
  })
})
