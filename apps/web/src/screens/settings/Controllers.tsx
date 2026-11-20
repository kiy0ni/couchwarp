import { useEffect, useRef, useState } from 'react'
import { PlayerBadge } from '../../components/PlayerBadge'
import { t } from '../../i18n'
import { padName } from '../../lib/gamepads'
import { useGamepads } from '../../lib/use-gamepads'

/** How far the stick dot moves at full tilt, in its own widths: to the edge of the well. */
const STICK_TRAVEL = 83

/** Standard mapping names, in the browser's button order. */
const BUTTONS = [
  'A',
  'B',
  'X',
  'Y',
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
] as const

/** Every connected controller, live. */
export function ControllerTesters() {
  const gamepads = useGamepads()
  return (
    <div className="stack stack--loose">
      {gamepads.length === 0 ? (
        <section className="card card--feature">
          <h2 className="card__title">{t.settings.noController}</h2>
          <p className="card__text">{t.settings.noControllerHelp}</p>
        </section>
      ) : (
        gamepads.map((gamepad, index) => (
          <PadTester key={gamepad.index} index={gamepad.index} slot={index + 1} />
        ))
      )}
    </div>
  )
}

/** One controller, live: buttons light up, sticks move, triggers fill. */
function PadTester({ index, slot }: { index: number; slot: number }) {
  const [pad, setPad] = useState<Gamepad | null>(null)
  const frame = useRef(0)
  useEffect(() => {
    const tick = () => {
      setPad(navigator.getGamepads()[index] ?? null)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [index])
  if (!pad) return null

  const axis = (i: number) => pad.axes[i] ?? 0
  const value = (i: number) => pad.buttons[i]?.value ?? 0
  const rumble = () =>
    pad.vibrationActuator
      ?.playEffect('dual-rumble', { duration: 300, strongMagnitude: 0.8, weakMagnitude: 0.6 })
      .catch(() => undefined)

  return (
    <section className="card pad-tester">
      <header className="card__head">
        <span className="pad-tester__who">
          <PlayerBadge slot={slot} />
          <span className="card__title">{padName(pad)}</span>
        </span>
        {pad.vibrationActuator && (
          <button type="button" className="button button--small button--secondary" onClick={rumble}>
            {t.settings.rumble}
          </button>
        )}
      </header>
      <div className="pad-tester__body">
        <Stick label={t.settings.leftStick} x={axis(0)} y={axis(1)} />
        <div className="pad-tester__buttons">
          {BUTTONS.map((name, i) =>
            i < pad.buttons.length ? (
              <span key={name} className="pad-key" data-pressed={value(i) > 0.5 || undefined}>
                {name}
              </span>
            ) : null,
          )}
          <Trigger label="LT" value={value(6)} />
          <Trigger label="RT" value={value(7)} />
        </div>
        <Stick label={t.settings.rightStick} x={axis(2)} y={axis(3)} />
      </div>
      {pad.mapping !== 'standard' && <p className="field__help">{t.settings.nonStandard}</p>}
    </section>
  )
}

function Trigger({ label, value }: { label: string; value: number }) {
  return (
    <span className="pad-trigger">
      <span className="pad-trigger__label">{label}</span>
      <span className="pad-trigger__fill" style={{ transform: `scaleX(${value})` }} />
    </span>
  )
}

function Stick({ label, x, y }: { label: string; x: number; y: number }) {
  return (
    <figure className="stick">
      <span className="stick__well">
        <span
          className="stick__dot"
          style={{
            transform: `translate(${(x * STICK_TRAVEL).toFixed(0)}%, ${(y * STICK_TRAVEL).toFixed(0)}%)`,
          }}
        />
      </span>
      <figcaption className="field__help num">
        {label} {x.toFixed(2)} {y.toFixed(2)}
      </figcaption>
    </figure>
  )
}
