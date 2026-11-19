import { normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@couchwarp/protocol'
import { useEffect, useRef, useState } from 'react'
import { NAV_EVENT, type NavEvent } from '../lib/gamepad-nav'

interface Props {
  id: string
  value: string
  onChange(value: string): void
  invalid: boolean
  describedBy: string
}

/** Keeps only characters a room code can contain, uppercased, at most six. */
function clean(input: string): string {
  return [...normalizeRoomCode(input)]
    .filter((char) => ROOM_CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, ROOM_CODE_LENGTH)
}

function cycle(char: string | undefined, step: 1 | -1): string {
  if (!char) return step === 1 ? 'A' : '9'
  const next = ROOM_CODE_ALPHABET.indexOf(char) + step
  const length = ROOM_CODE_ALPHABET.length
  return ROOM_CODE_ALPHABET.charAt((next + length) % length)
}

/**
 * Six boxes for a room code. A real text input sits over them, so typing, pasting and
 * phone keyboards work as usual. With a controller, up and down change the letter in the
 * lit box and left and right move between boxes, like entering initials on a high score.
 */
export function CodeEntry({ id, value, onChange, invalid, describedBy }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [cursor, setCursor] = useState(Math.min(value.length, ROOM_CODE_LENGTH - 1))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const element = input.current
    if (!element) return
    const onNav = (event: Event) => {
      const { direction } = (event as NavEvent).detail
      if (direction === 'up' || direction === 'down') {
        event.preventDefault()
        const chars = [...value]
        chars[cursor] = cycle(chars[cursor], direction === 'up' ? 1 : -1)
        onChange(chars.join(''))
      } else if (direction === 'left' && cursor > 0) {
        event.preventDefault()
        setCursor(cursor - 1)
      } else if (direction === 'right' && cursor < Math.min(value.length, ROOM_CODE_LENGTH - 1)) {
        event.preventDefault()
        setCursor(cursor + 1)
      }
    }
    element.addEventListener(NAV_EVENT, onNav)
    return () => element.removeEventListener(NAV_EVENT, onNav)
  }, [cursor, value, onChange])

  return (
    <div className="code-entry" data-focused={focused || undefined}>
      <input
        ref={input}
        id={id}
        className="code-entry__input"
        value={value}
        onChange={(event) => {
          const next = clean(event.target.value)
          onChange(next)
          setCursor(Math.min(next.length, ROOM_CODE_LENGTH - 1))
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        name="code"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="go"
        maxLength={ROOM_CODE_LENGTH + 2}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        // biome-ignore lint/a11y/noAutofocus: single-purpose screen, focus lands where typing goes
        autoFocus
      />
      <div className="code-entry__boxes" aria-hidden="true">
        {Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the six boxes never reorder
            key={index}
            className="code-entry__box"
            data-cursor={focused && index === cursor ? true : undefined}
          >
            {value[index] ?? ''}
          </span>
        ))}
      </div>
    </div>
  )
}
