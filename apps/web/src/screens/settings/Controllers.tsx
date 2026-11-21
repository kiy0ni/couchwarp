import { useEffect, useState } from 'react'
import { ControllerSupport } from '../../components/ControllerSupport'
import { PadTester } from '../../components/PadTester'
import { PlayerBadge } from '../../components/PlayerBadge'
import { SettingRow, Switch } from '../../components/SettingRow'
import { t } from '../../i18n'
import { FAMILY_NAMES, familyOf } from '../../lib/controllers'
import { desktop, isDesktop } from '../../lib/desktop'
import { padName } from '../../lib/gamepads'
import {
  connectController,
  motionSource,
  resumeControllers,
  startNativeMotion,
  startPhoneMotion,
  stopPhoneMotion,
} from '../../lib/motion'
import { isCustom, layoutFor } from '../../lib/pad-layout'
import { setPreferences, usePreferences } from '../../lib/preferences'
import { useGamepads } from '../../lib/use-gamepads'

/** Every connected controller, live. */
export function ControllerTesters() {
  const gamepads = useGamepads()
  return (
    <div className="stack stack--loose">
      {isDesktop && <ControllerSupport />}
      <ControllerSettings />
      {gamepads.length === 0 ? (
        <section className="card stack">
          <h2 className="card__title">{t.settings.noController}</h2>
          <p className="card__text">{t.settings.noControllerHelp}</p>
        </section>
      ) : (
        gamepads.map((gamepad, index) => (
          <PadCard key={gamepad.index} index={gamepad.index} slot={index + 1} />
        ))
      )}
    </div>
  )
}

/** One connected controller: its name, and the way into the tester and its remapping. */
function PadCard({ index, slot }: { index: number; slot: number }) {
  usePreferences()
  const [testing, setTesting] = useState(false)
  const gamepad = navigator.getGamepads()[index]
  if (!gamepad) return null
  const family = familyOf(gamepad.id)
  const custom = isCustom(layoutFor(gamepad))
  return (
    <section className="card pad-card">
      <span className="pad-card__who">
        <PlayerBadge slot={slot} />
        <span className="pad-card__name">
          <span className="card__title">{padName(gamepad)}</span>
          <span className="muted">
            {[FAMILY_NAMES[family], custom ? t.padTest.customised : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </span>
      <button type="button" className="button button--small" onClick={() => setTesting(true)}>
        {t.padTest.open}
      </button>
      {testing && <PadTester index={index} slot={slot} onClose={() => setTesting(false)} />}
    </section>
  )
}

/** How controllers play: Nintendo letters, and motion from controllers or the phone. */
function ControllerSettings() {
  const preferences = usePreferences()
  const [connected, setConnected] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const source = motionSource()
  useEffect(() => {
    if (source === 'webhid') resumeControllers().then(setConnected).catch(console.error)
    if (source !== 'app') return
    // The app finds controllers on its own, plugged in or paired at any time.
    const look = () => desktop.motionControllers().then(setConnected).catch(console.error)
    startNativeMotion().then(look).catch(console.error)
    const timer = window.setInterval(look, 2000)
    return () => window.clearInterval(timer)
  }, [source])
  const touchScreen = matchMedia('(pointer: coarse)').matches
  return (
    <div className="settings__rows">
      <SettingRow id="pad-letters" title={t.settings.letters} help={t.settings.lettersHelp}>
        <Switch
          id="pad-letters"
          checked={preferences.nintendoLetters}
          onChange={(nintendoLetters) => setPreferences({ nintendoLetters })}
        />
      </SettingRow>
      {/* A phone has its own gyroscope below. */}
      {!touchScreen && (
        <SettingRow
          id="pad-motion"
          title={t.settings.motion}
          help={
            connected.length > 0
              ? t.settings.motionConnected(connected.join(', '))
              : source === 'app'
                ? t.settings.motionApp
                : source === 'webhid'
                  ? t.settings.motionHelp
                  : t.settings.motionUnsupported
          }
        >
          {source === 'webhid' && (
            <button
              id="pad-motion"
              type="button"
              className="button button--secondary button--small"
              onClick={() => {
                setProblem(null)
                connectController()
                  .then((names) =>
                    setConnected((previous) => [...new Set([...previous, ...names])]),
                  )
                  .catch(() => setProblem(t.settings.motionFailed))
              }}
            >
              {t.settings.motionConnect}
            </button>
          )}
        </SettingRow>
      )}
      {touchScreen && (
        <SettingRow id="pad-phone" title={t.settings.phoneMotion} help={t.settings.phoneMotionHelp}>
          <Switch
            id="pad-phone"
            checked={preferences.phoneMotion}
            onChange={(phoneMotion) => {
              if (!phoneMotion) {
                setPreferences({ phoneMotion })
                return
              }
              // Asked from this tap, as iPhones require.
              startPhoneMotion()
                .then((granted) => {
                  stopPhoneMotion()
                  setPreferences({ phoneMotion: granted })
                  if (!granted) setProblem(t.settings.phoneMotionRefused)
                })
                .catch(() => setProblem(t.settings.phoneMotionRefused))
            }}
          />
        </SettingRow>
      )}
      {problem && (
        <p className="field__help setting__problem" data-error role="status">
          {problem}
        </p>
      )}
    </div>
  )
}
