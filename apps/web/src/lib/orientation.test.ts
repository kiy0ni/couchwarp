import { describe, expect, it } from 'vitest'
import { OrientationFilter, rotate, type Vector } from './orientation'

const PER_DPS = 16.4
const PER_G = 8192
const STEP_MS = 10

/** Feeds the same reading for `seconds`, from `start` ms; returns the time reached. */
function feed(filter: OrientationFilter, dps: Vector, g: Vector, seconds: number, start = 0) {
  let at = start
  for (let i = 0; i <= (seconds * 1000) / STEP_MS; i++) {
    filter.update({
      gyro: dps.map((v) => v * PER_DPS) as Vector,
      accel: g.map((v) => v * PER_G) as Vector,
      at,
    })
    at += STEP_MS
  }
  return at
}

function close(a: Vector, b: Vector) {
  for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i] ?? 0, 1)
}

describe('controller orientation', () => {
  it('learns the gyroscope offset while the controller lies still, and stays level', () => {
    const filter = new OrientationFilter()
    feed(filter, [-15, 4, 60], [0, 1, 0], 5)
    expect(filter.calibrated).toBe(true)
    close(filter.offset, [-15, 4, 60])
    close(rotate(filter.orientation, [0, 1, 0]), [0, 1, 0])
  })

  it('follows gravity to a tilt it was not told about', () => {
    const filter = new OrientationFilter()
    // Nose up by 30°: gravity, seen from the controller, leans towards the player.
    const up: Vector = [0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]
    feed(filter, [0, 0, 0], up, 3)
    close(rotate(filter.orientation, up), [0, 1, 0])
  })

  it('turns with the gyroscope: a quarter turn to the left in one second', () => {
    const filter = new OrientationFilter()
    const at = feed(filter, [0, 0, 0], [0, 1, 0], 1)
    feed(filter, [0, 90, 0], [0, 1, 0], 1, at)
    // The cable end, which faced the player, now faces right.
    close(rotate(filter.orientation, [0, 0, 1]), [1, 0, 0])
  })
})

describe('learning the offset', () => {
  it('never takes a slow, smooth turn for an offset', () => {
    const filter = new OrientationFilter()
    let at = 0
    for (let i = 0; i < 500; i++) {
      // 20° per second one way, then the other: an aim moving slowly.
      const yaw = 20 * Math.sin(i / 60)
      filter.update({ gyro: [0, yaw * 16.4, 0], accel: [0, 8192, 0], at })
      at += 10
    }
    expect(filter.calibrated).toBe(false)
    expect(Math.abs(filter.offset[1])).toBeLessThan(0.5)
  })
})
