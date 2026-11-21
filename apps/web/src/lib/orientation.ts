/**
 * Where a controller points, from its gyroscope and accelerometer, as emulators and Steam
 * show it. A Mahony filter: the gyroscope turns the controller every reading, and gravity
 * slowly pulls the estimate back level, so it never drifts on pitch and roll. Yaw has
 * nothing to correct it and is recentred by hand.
 *
 * Gyroscopes read a little off zero at rest, a Switch controller's by several degrees per
 * second: while the controller lies still, that offset is learnt and taken away.
 *
 * Axes are a DualShock 4's, which `motion.ts` turns every controller into: x to the right,
 * y up out of the face, z towards the player.
 */

/** DualShock 4 units: about 16.4 per degree per second, 8192 per g. */
const PER_DPS = 16.4
const PER_G = 8192
const RADIANS = Math.PI / 180
/** How hard gravity pulls the estimate; strong at first, to settle within a second. */
const PULL = 0.6
const FIRST_PULL = 8
const SETTLE_S = 1
/**
 * Still, as in GamepadMotionHelpers (what Steam and SDL use): over a whole window, each
 * gyroscope axis stays within a narrow band and gravity barely moves. A slow, smooth turn
 * drifts out of the band; a hand always trembles more than this.
 */
const STILL_BAND_DPS = 1.5
const STILL_BAND_G = 0.02
const STILL_S = 0.8
/** Gravity this far from 1 g means the controller is being moved, not lying still. */
const STILL_G = 0.06
/** How fast the learnt offset follows the gyroscope while still. */
const OFFSET_RATE = 2
const MAX_STEP_S = 0.1

export type Quaternion = [w: number, x: number, y: number, z: number]
export type Vector = [number, number, number]

export const IDENTITY: Quaternion = [1, 0, 0, 0]

export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [aw, ax, ay, az] = a
  const [bw, bx, by, bz] = b
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ]
}

export function conjugate([w, x, y, z]: Quaternion): Quaternion {
  return [w, -x, -y, -z]
}

function normalise(q: Quaternion): Quaternion {
  const length = Math.hypot(...q) || 1
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length]
}

/** `v`, given in the controller's axes, in the world's. */
export function rotate(q: Quaternion, v: Vector): Vector {
  const [, x, y, z] = multiply(multiply(q, [0, ...v]), conjugate(q))
  return [x, y, z]
}

/** A turn of `degrees` around the world's vertical axis. */
export function yawTurn(degrees: number): Quaternion {
  const half = (degrees * RADIANS) / 2
  return [Math.cos(half), 0, Math.sin(half), 0]
}

export interface Reading {
  /** Turn rates, DualShock units. */
  gyro: Vector
  /** Acceleration with gravity, DualShock units. */
  accel: Vector
  /** When it was read, in ms. */
  at: number
}

export class OrientationFilter {
  /** The controller's turn from the world: level, facing the screen, at the start. */
  orientation: Quaternion = IDENTITY
  /** The gyroscope's reading at rest, in degrees per second, taken away from each reading. */
  offset: Vector = [0, 0, 0]
  /** Whether the controller has lain still long enough to learn the offset. */
  calibrated = false
  private last: Reading | null = null
  private elapsed = 0
  /** Readings of the current still window, in degrees per second and g. */
  private window: { at: number; dps: Vector; g: Vector }[] = []

  update(reading: Reading): void {
    const previous = this.last
    this.last = reading
    if (!previous) return
    const dt = Math.min(MAX_STEP_S, Math.max(0, (reading.at - previous.at) / 1000))
    if (dt === 0) return
    this.elapsed += dt

    const dps = reading.gyro.map((value) => value / PER_DPS) as Vector
    this.learnOffset(dps, reading, dt)
    const rate = dps.map((value, i) => (value - (this.offset[i] ?? 0)) * RADIANS) as Vector
    const correction = this.gravityError(reading.accel)
    const pull = this.elapsed < SETTLE_S ? FIRST_PULL : PULL
    const turn = rate.map((value, i) => value + pull * (correction[i] ?? 0)) as Vector

    const [w, x, y, z] = this.orientation
    const [gx, gy, gz] = turn
    const half = dt / 2
    this.orientation = normalise([
      w + half * (-x * gx - y * gy - z * gz),
      x + half * (w * gx + y * gz - z * gy),
      y + half * (w * gy - x * gz + z * gx),
      z + half * (w * gz + x * gy - y * gx),
    ])
  }

  /**
   * How far the estimate is from what gravity says, as a turn in the controller's axes:
   * zero when the measured "up" and the estimated "up" agree.
   */
  private gravityError(accel: Vector): Vector {
    const g = Math.hypot(...accel) / PER_G
    if (g < 0.7 || g > 1.3) return [0, 0, 0]
    const measured = accel.map((value) => value / (g * PER_G)) as Vector
    const [w, x, y, z] = this.orientation
    // The world's up, seen from the controller.
    const expected: Vector = [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)]
    return cross(measured, expected)
  }

  private learnOffset(dps: Vector, reading: Reading, dt: number): void {
    const g = reading.accel.map((value) => value / PER_G) as Vector
    if (Math.abs(Math.hypot(...g) - 1) > STILL_G) {
      this.window = []
      return
    }
    this.window.push({ at: reading.at, dps, g })
    while ((this.window[0]?.at ?? reading.at) < reading.at - STILL_S * 1000) this.window.shift()
    const span = (pick: (entry: (typeof this.window)[number]) => Vector, axis: number) => {
      const values = this.window.map((entry) => pick(entry)[axis] ?? 0)
      return Math.max(...values) - Math.min(...values)
    }
    const covered = reading.at - (this.window[0]?.at ?? reading.at) >= STILL_S * 1000 * 0.9
    const still =
      covered &&
      [0, 1, 2].every(
        (axis) =>
          span((entry) => entry.dps, axis) < STILL_BAND_DPS &&
          span((entry) => entry.g, axis) < STILL_BAND_G,
      )
    if (!still) return
    const mean = [0, 1, 2].map(
      (axis) =>
        this.window.reduce((sum, entry) => sum + (entry.dps[axis] ?? 0), 0) / this.window.length,
    )
    const share = Math.min(1, OFFSET_RATE * dt)
    this.offset = this.offset.map((value, i) => value + share * ((mean[i] ?? 0) - value)) as Vector
    const left = Math.hypot(...mean.map((value, i) => value - (this.offset[i] ?? 0)))
    if (left < STILL_BAND_DPS) this.calibrated = true
  }
}

function cross([ax, ay, az]: Vector, [bx, by, bz]: Vector): Vector {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
}
