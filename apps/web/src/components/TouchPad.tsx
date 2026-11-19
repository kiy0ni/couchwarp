import { Button } from '@couchwarp/protocol'
import { type PointerEvent, type RefObject, useRef, useState } from 'react'
import { t } from '../i18n'
import type { PadState } from '../lib/pad-state'

const STICK_RADIUS = 56
const AXIS_MAX = 32767
const TRIGGER_MAX = 255

type Trigger = 'leftTrigger' | 'rightTrigger'
type Group = 'face' | 'left' | 'right' | 'menu'
interface Control {
  label: string
  button?: number
  trigger?: Trigger
  area: string
  group: Group
}

/** Placement follows the Xbox touch guidelines: primary actions under the right thumb. */
const CONTROLS: readonly Control[] = [
  { label: 'A', button: Button.a, area: 'a', group: 'face' },
  { label: 'B', button: Button.b, area: 'b', group: 'face' },
  { label: 'X', button: Button.x, area: 'x', group: 'face' },
  { label: 'Y', button: Button.y, area: 'y', group: 'face' },
  { label: 'LB', button: Button.leftBumper, area: 'lb', group: 'left' },
  { label: 'RB', button: Button.rightBumper, area: 'rb', group: 'right' },
  { label: 'LT', trigger: 'leftTrigger', area: 'lt', group: 'left' },
  { label: 'RT', trigger: 'rightTrigger', area: 'rt', group: 'right' },
  { label: 'Select', button: Button.back, area: 'back', group: 'menu' },
  { label: 'Start', button: Button.start, area: 'start', group: 'menu' },
]

const GROUPS: readonly Group[] = ['left', 'right', 'face', 'menu']

interface Stick {
  pointer: number
  originX: number
  originY: number
  x: number
  y: number
}

/**
 * An on-screen controller for phones and tablets without a physical one. The stick
 * appears where the thumb lands. The current state is written to `state` for the input
 * loop to send; nothing here talks to the network.
 */
export function TouchPad({ state }: { state: RefObject<PadState | null> }) {
  const [stick, setStick] = useState<Stick | null>(null)
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set())
  const held = useRef(new Set<string>())
  const stickRef = useRef<Stick | null>(null)

  function publish() {
    let buttons = 0
    const triggers = { leftTrigger: 0, rightTrigger: 0 }
    for (const control of CONTROLS) {
      if (!held.current.has(control.area)) continue
      if (control.button) buttons |= control.button
      if (control.trigger) triggers[control.trigger] = TRIGGER_MAX
    }
    const current = stickRef.current
    const axis = (value: number) => Math.round((value / STICK_RADIUS) * AXIS_MAX)
    state.current = {
      buttons,
      leftStick: current ? [axis(current.x), axis(current.y)] : [0, 0],
      rightStick: [0, 0],
      ...triggers,
    }
    setPressed(new Set(held.current))
  }

  function moveStick(next: Stick | null) {
    stickRef.current = next
    setStick(next)
    publish()
  }

  function onStickDown(event: PointerEvent<HTMLDivElement>) {
    if (stickRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    moveStick({
      pointer: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      x: 0,
      y: 0,
    })
  }

  function onStickMove(event: PointerEvent<HTMLDivElement>) {
    const current = stickRef.current
    if (current?.pointer !== event.pointerId) return
    const dx = event.clientX - current.originX
    const dy = event.clientY - current.originY
    const scale = Math.min(1, STICK_RADIUS / (Math.hypot(dx, dy) || 1))
    moveStick({ ...current, x: dx * scale, y: dy * scale })
  }

  function onStickUp(event: PointerEvent<HTMLDivElement>) {
    if (stickRef.current?.pointer === event.pointerId) moveStick(null)
  }

  function press(area: string, down: boolean) {
    if (down === held.current.has(area)) return
    if (down) {
      held.current.add(area)
      navigator.vibrate?.(8)
    } else {
      held.current.delete(area)
    }
    publish()
  }

  return (
    <div className="touchpad">
      <div
        className="touchpad__stick-zone"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
        aria-label={t.play.touchStick}
        role="presentation"
      >
        {stick && (
          <span
            className="touchpad__stick"
            style={{ left: stick.originX, top: stick.originY }}
            aria-hidden="true"
          >
            <span
              className="touchpad__knob"
              style={{ transform: `translate(${stick.x}px, ${stick.y}px)` }}
            />
          </span>
        )}
      </div>
      {GROUPS.map((group) => (
        <div key={group} className="touchpad__group" data-group={group}>
          {CONTROLS.filter((control) => control.group === group).map((control) => (
            <button
              key={control.area}
              type="button"
              className="touchpad__button"
              data-area={control.area}
              data-pressed={pressed.has(control.area) || undefined}
              aria-label={control.label}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                press(control.area, true)
              }}
              onPointerUp={() => press(control.area, false)}
              onPointerCancel={() => press(control.area, false)}
              onContextMenu={(event) => event.preventDefault()}
            >
              {control.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
