import { Button } from '@couchwarp/protocol'
import type { PadState } from './pad-state'

type Stick = 'leftStick' | 'rightStick'
type Binding =
  | { button: number }
  | { stick: Stick; x: -1 | 0 | 1; y: -1 | 0 | 1 }
  | { trigger: 'leftTrigger' | 'rightTrigger' }

const AXIS_MAX = 32767
const TRIGGER_MAX = 255

/**
 * Default keyboard layout, by physical key (`KeyboardEvent.code`), so it falls in the same
 * place on QWERTY and AZERTY: left hand on the left stick, right hand on the face buttons
 * laid out as on a controller (I up, J left, K down, L right).
 */
export const KEYBOARD_LAYOUT: Readonly<Record<string, Binding>> = {
  KeyW: { stick: 'leftStick', x: 0, y: -1 },
  KeyA: { stick: 'leftStick', x: -1, y: 0 },
  KeyS: { stick: 'leftStick', x: 0, y: 1 },
  KeyD: { stick: 'leftStick', x: 1, y: 0 },
  ArrowUp: { stick: 'rightStick', x: 0, y: -1 },
  ArrowLeft: { stick: 'rightStick', x: -1, y: 0 },
  ArrowDown: { stick: 'rightStick', x: 0, y: 1 },
  ArrowRight: { stick: 'rightStick', x: 1, y: 0 },
  KeyK: { button: Button.a },
  KeyL: { button: Button.b },
  KeyJ: { button: Button.x },
  KeyI: { button: Button.y },
  KeyT: { button: Button.dpadUp },
  KeyF: { button: Button.dpadLeft },
  KeyG: { button: Button.dpadDown },
  KeyH: { button: Button.dpadRight },
  KeyQ: { button: Button.leftBumper },
  KeyO: { button: Button.rightBumper },
  KeyE: { trigger: 'leftTrigger' },
  KeyU: { trigger: 'rightTrigger' },
  KeyC: { button: Button.leftStick },
  KeyM: { button: Button.rightStick },
  Tab: { button: Button.back },
  Enter: { button: Button.start },
}

/** The controller state the held keys stand for. Opposite directions cancel out. */
export function keyboardPadState(held: ReadonlySet<string>): PadState {
  let buttons = 0
  const sticks: Record<Stick, [number, number]> = { leftStick: [0, 0], rightStick: [0, 0] }
  const triggers = { leftTrigger: 0, rightTrigger: 0 }
  for (const code of held) {
    const binding = KEYBOARD_LAYOUT[code]
    if (!binding) continue
    if ('button' in binding) buttons |= binding.button
    else if ('trigger' in binding) triggers[binding.trigger] = TRIGGER_MAX
    else {
      sticks[binding.stick][0] += binding.x
      sticks[binding.stick][1] += binding.y
    }
  }
  const scale = ([x, y]: [number, number]) => {
    // Diagonals keep the stick on its circle instead of reaching the corner.
    const length = Math.hypot(x, y) || 1
    return [Math.round((x / length) * AXIS_MAX), Math.round((y / length) * AXIS_MAX)] as const
  }
  return {
    buttons,
    leftStick: scale(sticks.leftStick),
    rightStick: scale(sticks.rightStick),
    ...triggers,
  }
}
