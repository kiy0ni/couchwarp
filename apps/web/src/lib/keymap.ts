/**
 * `KeyboardEvent.code` to USB HID usage (keyboard page 0x07).
 *
 * `code` names the physical key, whatever the layout: a guest on AZERTY pressing the key
 * labelled Z sends the same usage as a host on QWERTY pressing W, so movement keys stay
 * under the same fingers. The host decides what each usage means on its side.
 */

const NAMED_KEYS: Record<string, number> = {
  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  Space: 0x2c,
  Minus: 0x2d,
  Equal: 0x2e,
  BracketLeft: 0x2f,
  BracketRight: 0x30,
  Backslash: 0x31,
  IntlHash: 0x32,
  Semicolon: 0x33,
  Quote: 0x34,
  Backquote: 0x35,
  Comma: 0x36,
  Period: 0x37,
  Slash: 0x38,
  CapsLock: 0x39,
  PrintScreen: 0x46,
  ScrollLock: 0x47,
  Pause: 0x48,
  Insert: 0x49,
  Home: 0x4a,
  PageUp: 0x4b,
  Delete: 0x4c,
  End: 0x4d,
  PageDown: 0x4e,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,
  NumLock: 0x53,
  NumpadDivide: 0x54,
  NumpadMultiply: 0x55,
  NumpadSubtract: 0x56,
  NumpadAdd: 0x57,
  NumpadEnter: 0x58,
  Numpad0: 0x62,
  NumpadDecimal: 0x63,
  IntlBackslash: 0x64,
  ContextMenu: 0x65,
  NumpadEqual: 0x67,
  ControlLeft: 0xe0,
  ShiftLeft: 0xe1,
  AltLeft: 0xe2,
  MetaLeft: 0xe3,
  ControlRight: 0xe4,
  ShiftRight: 0xe5,
  AltRight: 0xe6,
  MetaRight: 0xe7,
}

/** HID usage for a physical key, or undefined for keys the protocol does not carry. */
export function hidUsage(code: string): number | undefined {
  const letter = code.match(/^Key([A-Z])$/)?.[1]
  if (letter) return 0x04 + letter.charCodeAt(0) - 'A'.charCodeAt(0)

  const digit = code.match(/^Digit([0-9])$/)?.[1]
  // HID orders the digit row 1 to 9, then 0.
  if (digit) return digit === '0' ? 0x27 : 0x1e + Number(digit) - 1

  const numpad = code.match(/^Numpad([1-9])$/)?.[1]
  if (numpad) return 0x59 + Number(numpad) - 1

  const fn = code.match(/^F([1-9]|1[0-2])$/)?.[1]
  if (fn) return 0x3a + Number(fn) - 1

  return NAMED_KEYS[code]
}
