import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { FACE_LABELS, FAMILY_NAMES, type Family, familyOf } from '../lib/controllers'
import { holdGamepadNavigation } from '../lib/gamepad-nav'
import { padName } from '../lib/gamepads'
import { type Motion, motionFor } from '../lib/motion'
import {
  DEFAULT_LAYOUT,
  GAME_BUTTONS,
  layoutFor,
  MAX_DEAD_ZONE,
  type PadLayout,
  remap,
  saveLayout,
} from '../lib/pad-layout'
import { usePreferences } from '../lib/preferences'
import { PlayerBadge } from './PlayerBadge'
import { SettingRow, Switch } from './SettingRow'

/** Holding Select and Start this long ends the test, as on a console. */
const EXIT_HOLD_MS = 1000
const SELECT = 8
const START = 9

/** Names printed on each button of the standard mapping, by maker. */
const BUTTON_NAMES: Record<Family, readonly string[]> = {
  xbox: ['LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→', 'Xbox', 'Share'],
  playstation: [
    'L1',
    'R1',
    'L2',
    'R2',
    'Create',
    'Options',
    'L3',
    'R3',
    '↑',
    '↓',
    '←',
    '→',
    'PS',
    'Touchpad',
  ],
  nintendo: ['L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', '↑', '↓', '←', '→', 'Home', 'Capture'],
  generic: [
    'LB',
    'RB',
    'LT',
    'RT',
    'Select',
    'Start',
    'L3',
    'R3',
    '↑',
    '↓',
    '←',
    '→',
    'Home',
    '17',
  ],
}

export function buttonName(family: Family, index: number): string {
  return index < 4
    ? (FACE_LABELS[family][index] ?? String(index))
    : (BUTTON_NAMES[family][index - 4] ?? String(index))
}

/**
 * The controller as read this frame, copied: WebKit hands back the same live object every
 * time, so keeping it would never show a change.
 */
interface Snapshot {
  id: string
  mapping: string
  buttons: { pressed: boolean; value: number }[]
  axes: number[]
  rumble: boolean
  motion: Motion | null
}

function snapshot(index: number): Snapshot | null {
  const pad = navigator.getGamepads()[index]
  if (!pad?.connected) return null
  return {
    id: pad.id,
    mapping: pad.mapping,
    buttons: pad.buttons.map((button) => ({ pressed: button.pressed, value: button.value })),
    axes: [...pad.axes],
    rumble: Boolean(pad.vibrationActuator),
    motion: motionFor(pad, performance.now()),
  }
}

function useSnapshot(index: number): Snapshot | null {
  const [pad, setPad] = useState(() => snapshot(index))
  useEffect(() => {
    let frame = 0
    const tick = () => {
      setPad(snapshot(index))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [index])
  return pad
}

/** DualShock 4 units, as `motion.ts` gives them. */
const PER_DPS = 16.4
const PER_G = 8192
/** How much each frame trusts gravity over the gyroscope: drift goes, shaking stays smooth. */
const GRAVITY_WEIGHT = 0.04
/** Yaw has no gravity to correct it: it slowly comes back to the front instead. */
const YAW_RETURN = 0.995
/** Beyond this the drawing would cover the readings; the real controller can go further. */
const MAX_TILT = 45

interface Orientation {
  pitch: number
  yaw: number
  roll: number
}

const LEVEL: Orientation = { pitch: 0, yaw: 0, roll: 0 }

/**
 * Where the controller points, from its gyroscope and accelerometer (a complementary
 * filter), relative to how it was held when last centred.
 */
function useOrientation(motion: Motion | null): [Orientation, () => void] {
  const state = useRef({ angles: LEVEL, origin: LEVEL, at: 0 })
  const [angles, setAngles] = useState(LEVEL)
  useEffect(() => {
    if (!motion || motion.at === state.current.at) return
    const current = state.current
    const dt = current.at === 0 ? 0 : Math.min(0.1, (motion.at - current.at) / 1000)
    current.at = motion.at
    const [gx, gy, gz] = motion.gyro.map((value) => value / PER_DPS) as [number, number, number]
    const [ax, ay, az] = motion.accel.map((value) => value / PER_G) as [number, number, number]
    const fromGravity = {
      pitch: (Math.atan2(az, ay) * 180) / Math.PI,
      roll: (Math.atan2(-ax, ay) * 180) / Math.PI,
    }
    const blend = (angle: number, rate: number, gravity: number) =>
      (1 - GRAVITY_WEIGHT) * (angle + rate * dt) + GRAVITY_WEIGHT * gravity
    current.angles = {
      pitch: blend(current.angles.pitch, gx, fromGravity.pitch),
      yaw: (current.angles.yaw + gy * dt) * YAW_RETURN,
      roll: blend(current.angles.roll, gz, fromGravity.roll),
    }
    setAngles({
      pitch: current.angles.pitch - current.origin.pitch,
      yaw: current.angles.yaw - current.origin.yaw,
      roll: current.angles.roll - current.origin.roll,
    })
  }, [motion])
  const centre = () => {
    state.current.origin = { ...state.current.angles, yaw: 0 }
    state.current.angles = { ...state.current.angles, yaw: 0 }
  }
  return [angles, centre]
}

const clampTilt = (value: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, value))

/**
 * The full-screen tester: the controller drawn and lit as it is used, tilting with its
 * gyroscope, and its remapping beside it. While open, the controller never moves through
 * the app; Escape, the button, or Select and Start held together end it.
 */
export function PadTester({
  index,
  slot,
  onClose,
}: {
  index: number
  slot: number
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pad = useSnapshot(index)
  const [orientation, centre] = useOrientation(pad?.motion ?? null)
  const exitSince = useRef<number | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
    return holdGamepadNavigation()
  }, [])

  const exiting = pad?.buttons[SELECT]?.pressed && pad.buttons[START]?.pressed
  useEffect(() => {
    if (!exiting) {
      exitSince.current = null
      return
    }
    exitSince.current ??= performance.now()
    if (performance.now() - exitSince.current >= EXIT_HOLD_MS) onClose()
  })

  const family = pad ? familyOf(pad.id) : 'generic'
  return (
    <dialog ref={dialog} className="pad-test" aria-labelledby="pad-test-title" onClose={onClose}>
      <header className="pad-test__head">
        <span className="pad-test__who">
          <PlayerBadge slot={slot} />
          <span>
            <h2 id="pad-test-title" className="pad-test__title">
              {pad ? padName(pad) : t.padTest.gone}
            </h2>
            {FAMILY_NAMES[family] && <span className="muted">{FAMILY_NAMES[family]}</span>}
          </span>
        </span>
        <span className="actions">
          {pad?.rumble && (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() =>
                navigator.getGamepads()[index]?.vibrationActuator?.playEffect('dual-rumble', {
                  duration: 400,
                  strongMagnitude: 0.8,
                  weakMagnitude: 0.6,
                })
              }
            >
              {t.settings.rumble}
            </button>
          )}
          <button type="button" className="button button--small" onClick={onClose}>
            {t.padTest.done}
          </button>
        </span>
      </header>
      <p className="pad-test__hint">{exiting ? t.padTest.exiting : t.padTest.locked}</p>

      {pad ? (
        <div className="pad-test__body">
          <section className="pad-test__stage" aria-label={t.padTest.live}>
            <div
              className="pad-test__tilt"
              style={{
                transform: `perspective(900px) rotateX(${clampTilt(-orientation.pitch).toFixed(1)}deg) rotateY(${clampTilt(orientation.yaw).toFixed(1)}deg) rotateZ(${clampTilt(orientation.roll).toFixed(1)}deg)`,
              }}
            >
              <PadDrawing family={family} pad={pad} deadZone={layoutFor(pad).deadZone} />
            </div>
            <Readouts pad={pad} family={family} />
            <MotionView motion={pad.motion} onCentre={centre} />
            {pad.mapping !== 'standard' && <p className="field__help">{t.settings.nonStandard}</p>}
          </section>
          <Remapping pad={pad} family={family} />
        </div>
      ) : (
        <p className="muted">{t.padTest.goneHelp}</p>
      )}
    </dialog>
  )
}

const pressed = (pad: Snapshot, index: number) => pad.buttons[index]?.pressed === true

/** Where each part sits; PlayStation controllers have the d-pad up and both sticks down. */
function places(family: Family) {
  const playstation = family === 'playstation'
  return {
    leftStick: playstation ? { x: 168, y: 170 } : { x: 120, y: 120 },
    dpad: playstation ? { x: 120, y: 120 } : { x: 168, y: 170 },
    rightStick: { x: 252, y: 170 },
    face: { x: 300, y: 120 },
  }
}

function PadDrawing({
  family,
  pad,
  deadZone,
}: {
  family: Family
  pad: Snapshot
  deadZone: number
}) {
  const at = places(family)
  const lit = (index: number) => (pressed(pad, index) ? 'true' : undefined)
  const faces = [
    { index: 0, dx: 0, dy: 26 },
    { index: 1, dx: 26, dy: 0 },
    { index: 2, dx: -26, dy: 0 },
    { index: 3, dx: 0, dy: -26 },
  ]
  return (
    <svg className="pad-svg" viewBox="0 0 420 270" role="img" aria-label={t.padTest.drawing}>
      <Trigger x={70} value={pad.buttons[6]?.value ?? 0} label={buttonName(family, 6)} />
      <Trigger x={272} value={pad.buttons[7]?.value ?? 0} label={buttonName(family, 7)} />
      <rect
        className="pad-svg__part"
        data-lit={lit(4)}
        x="64"
        y="38"
        width="92"
        height="18"
        rx="9"
      />
      <rect
        className="pad-svg__part"
        data-lit={lit(5)}
        x="264"
        y="38"
        width="92"
        height="18"
        rx="9"
      />
      <path
        className="pad-svg__body"
        d="M 120 52 H 300 C 352 52 380 76 392 118 L 412 204 C 420 240 398 262 370 258 C 348 255 334 238 322 216 L 306 190 H 114 L 98 216 C 86 238 72 255 50 258 C 22 262 0 240 8 204 L 28 118 C 40 76 68 52 120 52 Z"
      />
      {family === 'playstation' && (
        <rect
          className="pad-svg__part"
          data-lit={lit(17)}
          x="174"
          y="66"
          width="72"
          height="44"
          rx="8"
        />
      )}
      <rect
        className="pad-svg__part"
        data-lit={lit(8)}
        x="168"
        y="116"
        width="20"
        height="11"
        rx="5"
      />
      <rect
        className="pad-svg__part"
        data-lit={lit(9)}
        x="232"
        y="116"
        width="20"
        height="11"
        rx="5"
      />
      <circle className="pad-svg__part" data-lit={lit(16)} cx="210" cy="148" r="10" />
      <Dpad x={at.dpad.x} y={at.dpad.y} pad={pad} />
      <Stick
        x={at.leftStick.x}
        y={at.leftStick.y}
        axisX={pad.axes[0] ?? 0}
        axisY={pad.axes[1] ?? 0}
        pressed={pressed(pad, 10)}
        deadZone={deadZone}
      />
      <Stick
        x={at.rightStick.x}
        y={at.rightStick.y}
        axisX={pad.axes[2] ?? 0}
        axisY={pad.axes[3] ?? 0}
        pressed={pressed(pad, 11)}
        deadZone={deadZone}
      />
      {faces.map(({ index, dx, dy }) => (
        <g key={index}>
          <circle
            className="pad-svg__part"
            data-lit={lit(index)}
            cx={at.face.x + dx}
            cy={at.face.y + dy}
            r="13"
          />
          <text
            className="pad-svg__label"
            x={at.face.x + dx}
            y={at.face.y + dy}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {buttonName(family, index)}
          </text>
        </g>
      ))}
    </svg>
  )
}

function Trigger({ x, value, label }: { x: number; value: number; label: string }) {
  const height = 26
  return (
    <g>
      <rect className="pad-svg__part" x={x} y="6" width="78" height={height} rx="8" />
      <rect
        className="pad-svg__fill"
        x={x}
        y={6 + height * (1 - value)}
        width="78"
        height={height * value}
        rx="8"
      />
      <text
        className="pad-svg__label pad-svg__label--small"
        x={x + 39}
        y={6 + height / 2}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
    </g>
  )
}

function Dpad({ x, y, pad }: { x: number; y: number; pad: Snapshot }) {
  const arms = [
    { index: 12, rx: x - 9, ry: y - 30, w: 18, h: 22 },
    { index: 13, rx: x - 9, ry: y + 8, w: 18, h: 22 },
    { index: 14, rx: x - 30, ry: y - 9, w: 22, h: 18 },
    { index: 15, rx: x + 8, ry: y - 9, w: 22, h: 18 },
  ]
  return (
    <g>
      <rect className="pad-svg__part" x={x - 9} y={y - 9} width="18" height="18" />
      {arms.map((arm) => (
        <rect
          key={arm.index}
          className="pad-svg__part"
          data-lit={pressed(pad, arm.index) ? 'true' : undefined}
          x={arm.rx}
          y={arm.ry}
          width={arm.w}
          height={arm.h}
          rx="4"
        />
      ))}
    </g>
  )
}

/** How far the stick's cap travels, in drawing units, at full tilt. */
const STICK_TRAVEL = 15

function Stick({
  x,
  y,
  axisX,
  axisY,
  pressed: down,
  deadZone,
}: {
  x: number
  y: number
  axisX: number
  axisY: number
  pressed: boolean
  deadZone: number
}) {
  return (
    <g>
      <circle className="pad-svg__well" cx={x} cy={y} r="29" />
      {deadZone > 0 && (
        <circle className="pad-svg__dead" cx={x} cy={y} r={Math.max(2, deadZone * 29)} />
      )}
      <circle
        className="pad-svg__part pad-svg__cap"
        data-lit={down ? 'true' : undefined}
        cx={x + axisX * STICK_TRAVEL}
        cy={y + axisY * STICK_TRAVEL}
        r="17"
      />
    </g>
  )
}

function Readouts({ pad, family }: { pad: Snapshot; family: Family }) {
  const axis = (i: number) => (pad.axes[i] ?? 0).toFixed(2)
  const percent = (i: number) => `${Math.round((pad.buttons[i]?.value ?? 0) * 100)} %`
  const held = pad.buttons
    .map((button, index) => (button.pressed ? buttonName(family, index) : null))
    .filter((name): name is string => name !== null)
  return (
    <dl className="pad-test__readouts num">
      <div>
        <dt>{t.settings.leftStick}</dt>
        <dd>
          {axis(0)} {axis(1)}
        </dd>
      </div>
      <div>
        <dt>{t.settings.rightStick}</dt>
        <dd>
          {axis(2)} {axis(3)}
        </dd>
      </div>
      <div>
        <dt>{t.padTest.triggers}</dt>
        <dd>
          {percent(6)} · {percent(7)}
        </dd>
      </div>
      <div>
        <dt>{t.padTest.pressed}</dt>
        <dd>{held.length > 0 ? held.join(' ') : '–'}</dd>
      </div>
    </dl>
  )
}

/** Turn rates as bars around zero, so a twist of the wrist shows at once. */
function MotionView({ motion, onCentre }: { motion: Motion | null; onCentre(): void }) {
  if (!motion) return <p className="field__help">{t.padTest.noMotion}</p>
  const rates = motion.gyro.map((value) => value / PER_DPS)
  const names = [t.padTest.pitch, t.padTest.yaw, t.padTest.roll]
  return (
    <div className="pad-test__motion">
      <div className="pad-test__rates">
        {rates.map((rate, i) => (
          <span key={names[i]} className="pad-rate">
            <span className="pad-rate__name">{names[i]}</span>
            <span className="pad-rate__track">
              <span
                className="pad-rate__bar"
                style={{ transform: `scaleX(${Math.max(-1, Math.min(1, rate / 360)).toFixed(3)})` }}
              />
            </span>
            <span className="pad-rate__value num">{Math.round(rate)}°/s</span>
          </span>
        ))}
      </div>
      <button type="button" className="button button--secondary button--small" onClick={onCentre}>
        {t.padTest.centre}
      </button>
    </div>
  )
}

/**
 * Which physical button plays each game button, and the sticks. A change saves at once,
 * for every controller of the same model, and applies to the next game.
 */
function Remapping({ pad, family }: { pad: Snapshot; family: Family }) {
  usePreferences()
  const layout = layoutFor(pad)
  const save = (next: PadLayout) => saveLayout(pad, next)
  const [capturing, setCapturing] = useState<number | null>(null)
  const baseline = useRef<Set<number>>(new Set())

  // While waiting, the first button pressed that was not already held is the new one.
  useEffect(() => {
    if (capturing === null) return
    const fresh = pad.buttons.findIndex(
      (button, index) => button.pressed && !baseline.current.has(index),
    )
    if (fresh === -1) return
    save(remap(layout, capturing, fresh))
    setCapturing(null)
  })

  const startCapture = (game: number) => {
    baseline.current = new Set(
      pad.buttons.flatMap((button, index) => (button.pressed ? [index] : [])),
    )
    setCapturing(game)
  }

  return (
    <section className="pad-test__settings" aria-labelledby="pad-remap-title">
      <header className="pad-test__settings-head">
        <h3 id="pad-remap-title" className="section__title">
          {t.padTest.remapTitle}
        </h3>
        <button type="button" className="link-button" onClick={() => save(DEFAULT_LAYOUT)}>
          {t.padTest.reset}
        </button>
      </header>
      <p className="field__help">{t.padTest.remapLead}</p>
      <ul className="remap">
        {GAME_BUTTONS.filter((game) => game < pad.buttons.length).map((game) => {
          const physical = layout.buttons[game] ?? game
          const changed = physical !== game
          return (
            <li key={game} className="remap__row" data-changed={changed || undefined}>
              <span className="remap__game">{buttonName(family, game)}</span>
              <span className="remap__arrow" aria-hidden="true">
                ←
              </span>
              <span className="remap__physical" data-lit={pressed(pad, physical) || undefined}>
                {capturing === game ? t.padTest.pressOne : buttonName(family, physical)}
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() => (capturing === game ? setCapturing(null) : startCapture(game))}
                aria-label={t.padTest.changeLabel(buttonName(family, game))}
              >
                {capturing === game ? t.common.cancel : t.padTest.change}
              </button>
            </li>
          )
        })}
      </ul>

      <h3 className="section__title">{t.padTest.sticksTitle}</h3>
      <div className="settings__rows">
        <SettingRow id="pad-dead-zone" title={t.padTest.deadZone} help={t.padTest.deadZoneHelp}>
          <span className="range">
            <input
              id="pad-dead-zone"
              type="range"
              min={0}
              max={MAX_DEAD_ZONE}
              step={0.01}
              value={layout.deadZone}
              onChange={(event) => save({ ...layout, deadZone: Number(event.target.value) })}
            />
            <output htmlFor="pad-dead-zone" className="num">
              {Math.round(layout.deadZone * 100)} %
            </output>
          </span>
        </SettingRow>
        {(
          [
            ['invertLeftY', t.padTest.invertLeft],
            ['invertRightY', t.padTest.invertRight],
            ['swapSticks', t.padTest.swapSticks],
          ] as const
        ).map(([key, title]) => (
          <SettingRow key={key} id={`pad-${key}`} title={title}>
            <Switch
              id={`pad-${key}`}
              checked={layout[key]}
              onChange={(checked) => save({ ...layout, [key]: checked })}
            />
          </SettingRow>
        ))}
      </div>
    </section>
  )
}
