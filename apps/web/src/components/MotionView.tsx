import { useEffect, useRef } from 'react'
import { t } from '../i18n'
import { motionKey, onMotion } from '../lib/motion'
import {
  conjugate,
  multiply,
  OrientationFilter,
  type Quaternion,
  rotate,
  type Vector,
  yawTurn,
} from '../lib/orientation'

const PER_DPS = 16.4
/** How much of the past the graph shows. */
const GRAPH_MS = 3000
/** The graph's height covers this many degrees per second either way. */
const GRAPH_DPS = 400

interface Sample {
  at: number
  dps: Vector
}

/**
 * The controller's motion, as Steam and emulators show it: a solid controller turning in
 * 3D as the real one does, and the turn rates of the last seconds as curves. Every
 * reading counts, not only one per frame, or fast turns would come out short.
 */
export function MotionView({ gamepadId }: { gamepadId: string }) {
  const filter = useRef(new OrientationFilter())
  const samples = useRef<Sample[]>([])
  const reference = useRef<Quaternion>([1, 0, 0, 0])
  const live = useRef(false)

  useEffect(() => {
    filter.current = new OrientationFilter()
    samples.current = []
    return onMotion((key, motion) => {
      if (key !== motionKey({ id: gamepadId }, performance.now())) return
      live.current = true
      filter.current.update(motion)
      const offset = filter.current.offset
      samples.current.push({
        at: motion.at,
        dps: motion.gyro.map((value, i) => value / PER_DPS - (offset[i] ?? 0)) as Vector,
      })
      while ((samples.current[0]?.at ?? Infinity) < motion.at - GRAPH_MS) samples.current.shift()
    })
  }, [gamepadId])

  const last = samples.current.at(-1)
  const fresh = live.current && last !== undefined && performance.now() - last.at < 300
  if (!fresh) return <p className="field__help">{t.padTest.noMotion}</p>

  // Facing the screen again, keeping the tilt gravity gives.
  const centre = () => {
    const forward = rotate(filter.current.orientation, [0, 0, 1])
    reference.current = yawTurn((Math.atan2(forward[0], forward[2]) * 180) / Math.PI)
  }
  const shown = multiply(conjugate(reference.current), filter.current.orientation)
  return (
    <div className="motion">
      <ControllerModel orientation={shown} />
      <div className="motion__side">
        <RateGraph samples={samples.current} now={last.at} />
        <p className="field__help">
          {filter.current.calibrated ? t.padTest.calibrated : t.padTest.calibrating}
        </p>
        <button type="button" className="button button--secondary button--small" onClick={centre}>
          {t.padTest.centre}
        </button>
      </div>
    </div>
  )
}

/** The outline of a controller seen from above: x to the right, z towards the player. */
const OUTLINE: readonly [number, number][] = [
  [-5, -3],
  [5, -3],
  [7, -2.4],
  [8.2, -0.5],
  [8.8, 3],
  [8, 5.6],
  [6.2, 6.3],
  [4.6, 4.8],
  [3.2, 3.4],
  [-3.2, 3.4],
  [-4.6, 4.8],
  [-6.2, 6.3],
  [-8, 5.6],
  [-8.8, 3],
  [-8.2, -0.5],
  [-7, -2.4],
]
const HALF_THICKNESS = 0.9
/** Seen from slightly above, as a controller in the hands. */
const CAMERA_TILT = (40 * Math.PI) / 180
const FOCAL = 45
const SCALE = 9.5
/** Shifts the model so its middle sits in the middle of the picture. */
const CENTRE_Z = 1.6

type Projected = { x: number; y: number; depth: number }

function toCamera([x, y, z]: Vector): Vector {
  const cos = Math.cos(CAMERA_TILT)
  const sin = Math.sin(CAMERA_TILT)
  return [x, y * cos - z * sin, y * sin + z * cos]
}

function project(point: Vector): Projected {
  const [x, y, z] = toCamera(point)
  const perspective = FOCAL / (FOCAL - z)
  return { x: x * SCALE * perspective, y: -y * SCALE * perspective, depth: z }
}

interface Face {
  key: string
  points: Vector[]
  normal: Vector
  kind: 'top' | 'side' | 'bottom'
}

/** The controller as a solid: top and bottom faces, and the side all around. */
function faces(): Face[] {
  const centre = OUTLINE.reduce(
    ([sx, sz], [x, z]) => [sx + x / OUTLINE.length, sz + z / OUTLINE.length],
    [0, 0],
  )
  const at = (x: number, y: number, z: number): Vector => [x, y, z - CENTRE_Z]
  const sides = OUTLINE.map(([x1, z1], i): Face => {
    const [x2, z2] = OUTLINE[(i + 1) % OUTLINE.length] ?? [x1, z1]
    let normal: Vector = [z2 - z1, 0, -(x2 - x1)]
    const outward = (x1 + x2) / 2 - (centre[0] ?? 0)
    const outwardZ = (z1 + z2) / 2 - (centre[1] ?? 0)
    if (normal[0] * outward + normal[2] * outwardZ < 0) normal = [-normal[0], 0, -normal[2]]
    const length = Math.hypot(...normal) || 1
    normal = [normal[0] / length, 0, normal[2] / length]
    return {
      key: `side-${i}`,
      kind: 'side',
      normal,
      points: [
        at(x1, HALF_THICKNESS, z1),
        at(x2, HALF_THICKNESS, z2),
        at(x2, -HALF_THICKNESS, z2),
        at(x1, -HALF_THICKNESS, z1),
      ],
    }
  })
  return [
    {
      key: 'top',
      kind: 'top',
      normal: [0, 1, 0],
      points: OUTLINE.map(([x, z]) => at(x, HALF_THICKNESS, z)),
    },
    {
      key: 'bottom',
      kind: 'bottom',
      normal: [0, -1, 0],
      points: OUTLINE.map(([x, z]) => at(x, -HALF_THICKNESS, z)),
    },
    ...sides,
  ]
}

const FACES = faces()

/** Round parts on the top face: sticks, face buttons in player colours, the d-pad. */
const DETAILS: readonly { x: number; z: number; r: number; part: string }[] = [
  { x: -2.6, z: 1.6, r: 1.2, part: 'stick' },
  { x: 2.6, z: 1.6, r: 1.2, part: 'stick' },
  { x: -5.4, z: -0.6, r: 1.1, part: 'dpad' },
  { x: 5.4, z: -1.6, r: 0.42, part: 'p4' },
  { x: 6.4, z: -0.6, r: 0.42, part: 'p2' },
  { x: 4.4, z: -0.6, r: 0.42, part: 'p3' },
  { x: 5.4, z: 0.4, r: 0.42, part: 'p1' },
]

function circle(x: number, z: number, r: number): Vector[] {
  return Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * Math.PI * 2
    return [x + Math.cos(angle) * r, HALF_THICKNESS + 0.02, z + Math.sin(angle) * r - CENTRE_Z]
  })
}

function ControllerModel({ orientation }: { orientation: Quaternion }) {
  const placed = FACES.map((face) => {
    const normal = toCamera(rotate(orientation, face.normal))
    const points = face.points.map((point) => project(rotate(orientation, point)))
    const depth = points.reduce((sum, point) => sum + point.depth, 0) / points.length
    return { face, points, depth, facing: normal[2], light: Math.max(0, normal[2]) }
  })
    .filter((face) => face.facing > 0)
    .sort((a, b) => a.depth - b.depth)
  const top = placed.find((face) => face.face.kind === 'top')
  const path = (points: Projected[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
    'Z'
  return (
    <svg className="model" viewBox="-150 -110 300 220" role="img" aria-label={t.padTest.model}>
      <ellipse className="model__shadow" cx="0" cy="52" rx="80" ry="9" />
      {placed.map(({ face, points, light }) => (
        <path
          key={face.key}
          className="model__face"
          data-kind={face.kind}
          d={path(points)}
          style={{
            fill: `color-mix(in oklab, var(--color-ink) ${Math.round(6 + light * 22)}%, var(--color-paper-2))`,
          }}
        />
      ))}
      {top &&
        DETAILS.map((detail) => (
          <path
            key={`${detail.part}-${detail.x}`}
            className="model__detail"
            data-part={detail.part}
            d={path(
              circle(detail.x, detail.z, detail.r).map((p) => project(rotate(orientation, p))),
            )}
          />
        ))}
    </svg>
  )
}

const AXES: readonly { name: 'pitch' | 'yaw' | 'roll'; index: number }[] = [
  { name: 'pitch', index: 0 },
  { name: 'yaw', index: 1 },
  { name: 'roll', index: 2 },
]

/** The three turn rates over the last seconds, newest on the right. */
function RateGraph({ samples, now }: { samples: Sample[]; now: number }) {
  const width = 300
  const height = 120
  const x = (at: number) => ((at - (now - GRAPH_MS)) / GRAPH_MS) * width
  const y = (dps: number) => height / 2 - (Math.max(-1, Math.min(1, dps / GRAPH_DPS)) * height) / 2
  const latest = samples.at(-1)?.dps ?? [0, 0, 0]
  return (
    <figure className="graph">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line className="graph__zero" x1="0" x2={width} y1={height / 2} y2={height / 2} />
        {AXES.map(({ name, index }) => (
          <polyline
            key={name}
            className="graph__line"
            data-axis={name}
            points={samples
              .map((sample) => `${x(sample.at).toFixed(1)},${y(sample.dps[index] ?? 0).toFixed(1)}`)
              .join(' ')}
          />
        ))}
      </svg>
      <figcaption className="graph__legend">
        {AXES.map(({ name, index }) => (
          <span key={name} className="graph__key" data-axis={name}>
            {t.padTest[name]} <span className="num">{Math.round(latest[index] ?? 0)}°/s</span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
