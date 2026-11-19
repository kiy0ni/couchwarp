import { useEffect, useState } from 'react'
import { t } from '../i18n'

type LayoutMap = ReadonlyMap<string, string>
type KeyboardMapNavigator = Navigator & { keyboard?: { getLayoutMap(): Promise<LayoutMap> } }

const ROWS: readonly { label: string; codes: readonly string[] }[] = [
  { label: t.play.keysMove, codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD'] },
  { label: t.play.keysCamera, codes: ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'] },
  { label: 'Y X A B', codes: ['KeyI', 'KeyJ', 'KeyK', 'KeyL'] },
  { label: t.play.keysDpad, codes: ['KeyT', 'KeyF', 'KeyG', 'KeyH'] },
  { label: 'LB RB', codes: ['KeyQ', 'KeyO'] },
  { label: 'LT RT', codes: ['KeyE', 'KeyU'] },
  { label: 'Select Start', codes: ['Tab', 'Enter'] },
]

const FALLBACK_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowDown: '↓',
  ArrowRight: '→',
  Tab: '⇥',
  Enter: '⏎',
}

/**
 * The keyboard-as-controller layout, named as printed on the guest's own keys: on an
 * AZERTY keyboard the movement keys read Z Q S D. Browsers without the Keyboard Map API
 * get the QWERTY names.
 */
export function KeyboardHelp() {
  const [layout, setLayout] = useState<LayoutMap | null>(null)

  useEffect(() => {
    ;(navigator as KeyboardMapNavigator).keyboard
      ?.getLayoutMap()
      .then(setLayout)
      // Without the layout map, QWERTY names are shown: still correct on most keyboards.
      .catch(() => setLayout(null))
  }, [])

  const label = (code: string) =>
    FALLBACK_LABELS[code] ?? layout?.get(code)?.toUpperCase() ?? code.replace(/^Key/, '')

  return (
    <dl className="keyhelp">
      {ROWS.map((row) => (
        <div key={row.label} className="keyhelp__row">
          <dt>{row.label}</dt>
          <dd>
            {row.codes.map((code) => (
              <kbd key={code}>{label(code)}</kbd>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  )
}
