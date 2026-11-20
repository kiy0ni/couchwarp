import { getVersion } from '@tauri-apps/api/app'
import { type ReactNode, useEffect, useState } from 'react'
import { KeyboardHelp } from '../components/KeyboardHelp'
import { Link } from '../components/Link'
import { Page } from '../components/Page'
import { Select, SettingRow, Switch } from '../components/SettingRow'
import { Shell } from '../components/Shell'
import { chosenLanguage, type LanguageChoice, setLanguage, t } from '../i18n'
import { isDesktop, system } from '../lib/desktop'
import { type Preferences, setPreferences, usePreferences } from '../lib/preferences'
import { navigate } from '../lib/router'
import { SHORTCUTS } from '../lib/use-input'
import { AccountTab } from './settings/Account'
import { ControllerTesters } from './settings/Controllers'

type Tab = 'game' | 'host' | 'network' | 'shortcuts' | 'controllers' | 'account' | 'app'

/** The tabs, in order. Hosting and network settings only exist in the desktop app. */
const TABS: readonly { id: Tab; path: string }[] = [
  { id: 'game', path: '/parametres' },
  ...(isDesktop
    ? ([
        { id: 'host', path: '/parametres/hote' },
        { id: 'network', path: '/parametres/reseau' },
      ] as const)
    : []),
  { id: 'shortcuts', path: '/parametres/raccourcis' },
  { id: 'controllers', path: '/parametres/manettes' },
  { id: 'account', path: '/parametres/compte' },
  { id: 'app', path: '/parametres/application' },
]

/** On a phone, the open tab scrolls into sight. */
function revealTab(element: HTMLAnchorElement | null) {
  element?.scrollIntoView({ block: 'nearest', inline: 'center' })
}

/** The settings, one tab per subject, the path saying which. */
export function Settings({ path }: { path: string }) {
  const tab = TABS.find((item) => item.path === path)?.id ?? 'game'
  return (
    <Shell onBack={() => navigate('/')}>
      <Page title={t.settings.title} lead={t.settings.lead}>
        <nav className="tabs" aria-label={t.settings.title}>
          {TABS.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className="tabs__item"
              aria-current={item.id === tab ? 'page' : undefined}
              ref={item.id === tab ? revealTab : undefined}
            >
              {t.settings.tabs[item.id]}
            </Link>
          ))}
        </nav>
        <section className="settings" aria-labelledby="settings-heading">
          <header className="settings__head">
            <h2 id="settings-heading" className="section__title">
              {t.settings.headings[tab]}
            </h2>
            <p className="muted">{t.settings.leads[tab]}</p>
          </header>
          {tab === 'game' && <GameSettings />}
          {tab === 'host' && <HostSettings />}
          {tab === 'network' && <NetworkSettings />}
          {tab === 'shortcuts' && <Shortcuts />}
          {tab === 'controllers' && <ControllerTesters />}
          {tab === 'account' && <AccountTab />}
          {tab === 'app' && <AppSettings />}
        </section>
      </Page>
    </Shell>
  )
}

type Flag = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never
}[keyof Preferences]

/** A preference shown as a switch. */
function PreferenceSwitch({ name, title, help }: { name: Flag; title: string; help: ReactNode }) {
  const preferences = usePreferences()
  return (
    <SettingRow id={`pref-${name}`} title={title} help={help}>
      <Switch
        id={`pref-${name}`}
        checked={preferences[name]}
        onChange={(checked) => setPreferences({ [name]: checked })}
      />
    </SettingRow>
  )
}

function GameSettings() {
  const preferences = usePreferences()
  const s = t.settings.game
  return (
    <div className="settings__rows">
      <PreferenceSwitch name="fullscreenOnStart" title={s.fullscreen} help={s.fullscreenHelp} />
      <PreferenceSwitch name="latencyOnBubble" title={s.latency} help={s.latencyHelp} />
      <PreferenceSwitch name="connectionWarnings" title={s.warnings} help={s.warningsHelp} />
      <PreferenceSwitch name="chatOverGame" title={s.chat} help={s.chatHelp} />
      <PreferenceSwitch name="touchPad" title={s.touch} help={s.touchHelp} />
      <SettingRow id="pref-keyboard" title={s.keyboard} help={s.keyboardHelp}>
        <Select<Preferences['keyboardMode']>
          id="pref-keyboard"
          value={preferences.keyboardMode}
          options={[
            ['pad', t.play.keyboardAsPad],
            ['keys', t.play.keyboardAsKeys],
          ]}
          onChange={(keyboardMode) => setPreferences({ keyboardMode })}
        />
      </SettingRow>
      <SettingRow id="pref-pad" title={s.padType} help={s.padTypeHelp}>
        <Select<Preferences['padType']>
          id="pref-pad"
          value={preferences.padType}
          options={[
            ['xbox360', t.room.padXbox],
            ['dualshock4', t.room.padPlayStation],
          ]}
          onChange={(padType) => setPreferences({ padType })}
        />
      </SettingRow>
      <SettingRow id="pref-mouse" title={s.mouse} help={s.mouseHelp}>
        <span className="range">
          <input
            id="pref-mouse"
            type="range"
            min={0.25}
            max={3}
            step={0.25}
            value={preferences.mouseSpeed}
            onChange={(event) => setPreferences({ mouseSpeed: Number(event.target.value) })}
          />
          <output htmlFor="pref-mouse" className="num">
            {s.speed(preferences.mouseSpeed)}
          </output>
        </span>
      </SettingRow>
      <SettingRow id="pref-bubble" title={s.bubble} help={s.bubbleHelp}>
        <button
          id="pref-bubble"
          type="button"
          className="button button--secondary button--small"
          onClick={() => setPreferences({ bubble: { x: 0.5, y: 0.02 } })}
        >
          {s.bubbleReset}
        </button>
      </SettingRow>
    </div>
  )
}

function HostSettings() {
  const preferences = usePreferences()
  const s = t.settings.host
  return (
    <div className="settings__rows">
      <SettingRow id="host-height" title={s.resolution} help={s.resolutionHelp}>
        <Select<Preferences['hostMaxHeight']>
          id="host-height"
          value={preferences.hostMaxHeight}
          options={[
            [720, '720p'],
            [1080, '1080p'],
            [1440, '1440p'],
          ]}
          onChange={(hostMaxHeight) => setPreferences({ hostMaxHeight })}
        />
      </SettingRow>
      <SettingRow id="host-fps" title={s.fps} help={s.fpsHelp}>
        <Select<Preferences['hostFps']>
          id="host-fps"
          value={preferences.hostFps}
          options={[
            [30, t.host.fps(30)],
            [60, t.host.fps(60)],
          ]}
          onChange={(hostFps) => setPreferences({ hostFps })}
        />
      </SettingRow>
      <SettingRow id="host-bitrate" title={s.bitrate} help={s.bitrateHelp}>
        <Select<number>
          id="host-bitrate"
          value={preferences.hostBitrate}
          options={[6, 10, 12, 20, 30, 50].map((mbps) => [mbps, t.host.bitrate(mbps)] as const)}
          onChange={(hostBitrate) => setPreferences({ hostBitrate })}
        />
      </SettingRow>
      <PreferenceSwitch name="hostBubble" title={s.bubble} help={s.bubbleHelp} />
      <PreferenceSwitch name="hostKeepAwake" title={s.awake} help={s.awakeHelp} />
      {system === 'mac' && (
        <PreferenceSwitch name="hostFocusLock" title={s.focus} help={s.focusHelp} />
      )}
    </div>
  )
}

function NetworkSettings() {
  const preferences = usePreferences()
  const s = t.settings.network
  const [port, setPort] = useState(String(preferences.hostPort))
  return (
    <div className="settings__rows">
      <SettingRow id="net-port" title={s.port} help={s.portHelp}>
        <input
          id="net-port"
          className="input"
          inputMode="numeric"
          value={port}
          onChange={(event) => setPort(event.target.value.replace(/\D/g, '').slice(0, 5))}
          onBlur={() => {
            const value = Number(port)
            const valid = value === 0 || (value > 1024 && value < 65536)
            setPreferences({ hostPort: valid ? value : 0 })
            setPort(String(valid ? value : 0))
          }}
        />
      </SettingRow>
      <SettingRow id="net-stun" title={s.stun} help={s.stunHelp}>
        <input
          id="net-stun"
          className="input"
          value={preferences.hostStun}
          spellCheck={false}
          onChange={(event) => setPreferences({ hostStun: event.target.value.trim() })}
        />
      </SettingRow>
      <SettingRow id="net-reset" title={s.reset} help={s.resetHelp}>
        <button
          id="net-reset"
          type="button"
          className="button button--secondary button--small"
          onClick={() => {
            setPreferences({ hostPort: 0, hostStun: 'stun.cloudflare.com:3478' })
            setPort('0')
          }}
        >
          {s.resetButton}
        </button>
      </SettingRow>
    </div>
  )
}

function Shortcuts() {
  const modifier = system === 'mac' ? '⌃ ⇧' : 'Ctrl + Shift +'
  const s = t.settings.shortcuts
  const rows: readonly [string, string, string][] = [
    [s.menu, s.menuHelp, SHORTCUTS.menu],
    [s.chat, s.chatHelp, SHORTCUTS.chat],
    [s.fullscreen, s.fullscreenHelp, SHORTCUTS.fullscreen],
  ]
  return (
    <div className="stack stack--loose">
      <div className="settings__rows">
        {rows.map(([title, help, code]) => (
          <Fixed key={code} title={title} help={help}>
            <kbd className="shortcut">
              {modifier} {code.replace('Key', '')}
            </kbd>
          </Fixed>
        ))}
        <Fixed title={s.mouse} help={s.mouseHelp}>
          <kbd className="shortcut">{s.escape}</kbd>
        </Fixed>
      </div>
      <section className="card stack">
        <h3 className="card__title">{s.keyboardTitle}</h3>
        <p className="card__text">{t.settings.keyboardLead}</p>
        <KeyboardHelp />
      </section>
    </div>
  )
}

/** A row that shows something rather than changing it. */
function Fixed({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__title">{title}</span>
        <p className="setting__help">{help}</p>
      </div>
      <div className="setting__control">{children}</div>
    </div>
  )
}

function AppSettings() {
  const [version, setVersion] = useState<string | null>(null)
  const [language, setChoice] = useState<LanguageChoice>(chosenLanguage)
  const s = t.settings
  useEffect(() => {
    if (!isDesktop) return
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null))
  }, [])
  return (
    <div className="settings__rows">
      <SettingRow id="app-language" title={s.languageLabel} help={s.languageHelp}>
        <Select<LanguageChoice>
          id="app-language"
          value={language}
          options={(['auto', 'fr', 'en'] as const).map((option) => [option, s.languages[option]])}
          onChange={(choice) => {
            setChoice(choice)
            setLanguage(choice)
          }}
        />
      </SettingRow>
      <Fixed
        title={isDesktop ? s.desktopApp : s.webApp}
        help={version ? s.version(version) : location.host}
      >
        {!isDesktop && (
          <Link to="/heberger" className="button button--secondary button--small">
            {t.home.downloadAction}
          </Link>
        )}
      </Fixed>
      <Fixed title={s.legalTitle} help={s.legalHelp}>
        <span className="setting__links">
          <Link to="/conditions" className="link-button">
            {t.footer.terms}
          </Link>
          <Link to="/confidentialite" className="link-button">
            {t.footer.privacy}
          </Link>
        </span>
      </Fixed>
    </div>
  )
}
