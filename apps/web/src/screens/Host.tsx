import { MAX_PLAYERS, MAX_TITLE_LENGTH } from '@couchwarp/protocol'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Choice } from '../components/Choice'
import { ConfirmButton } from '../components/ConfirmButton'
import { GameCover } from '../components/GameCover'
import { Icon } from '../components/Icon'
import { Link } from '../components/Link'
import { Page, Section } from '../components/Page'
import { InviteLink, RoomManager } from '../components/RoomManager'
import { Shell } from '../components/Shell'
import { t } from '../i18n'
import { useAccount } from '../lib/account'
import { useServerConfig } from '../lib/config'
import { desktop, type HostingState, isDesktop, system, type WindowInfo } from '../lib/desktop'
import { useKnownGame } from '../lib/games'
import { usePreferences } from '../lib/preferences'

/** In the desktop app, share a window; in a browser, get the app. */
export function Host() {
  return <Shell>{isDesktop ? <HostDesktop /> : <GetTheApp />}</Shell>
}

interface Downloads {
  mac: string | null
  windows: string | null
  /** The AppImage, which updates itself; the `.deb` package beside it. */
  linux: string | null
  linuxDeb: string | null
}

const NO_DOWNLOADS: Downloads = { mac: null, windows: null, linux: null, linuxDeb: null }

function GetTheApp() {
  const [downloads, setDownloads] = useState<Downloads | null>(null)
  useEffect(() => {
    fetch('/api/downloads')
      .then((response) => response.json() as Promise<Partial<Downloads>>)
      .then((found) => setDownloads({ ...NO_DOWNLOADS, ...found }))
      .catch(() => setDownloads(NO_DOWNLOADS))
  }, [])
  const platforms = [
    { id: 'mac', name: 'macOS', note: t.host.macNote, url: downloads?.mac ?? null, extra: null },
    {
      id: 'windows',
      name: 'Windows',
      note: t.host.windowsNote,
      url: downloads?.windows ?? null,
      extra: null,
    },
    {
      id: 'linux',
      name: 'Linux',
      note: t.host.linuxNote,
      url: downloads?.linux ?? null,
      extra: downloads?.linuxDeb ? { label: t.host.debPackage, url: downloads.linuxDeb } : null,
    },
  ]
  // The visitor's own system first.
  const ordered = [
    ...platforms.filter((platform) => platform.id === system),
    ...platforms.filter((platform) => platform.id !== system),
  ]
  return (
    <Page title={t.host.title} lead={t.host.webLead} width="narrow">
      <ol className="steps">
        {t.host.steps.map((step, index) => (
          <li key={step.title} className="steps__item">
            <span className="steps__number" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <span className="steps__title">{step.title}</span>
              <span className="steps__text">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="downloads">
        {ordered.map((platform) => (
          <section key={platform.id} className="card download">
            <h2 className="card__title">{platform.name}</h2>
            <p className="card__text">{platform.note}</p>
            {platform.url ? (
              <a className="button" href={platform.url}>
                <Icon name="download" />
                {t.host.download(platform.name)}
              </a>
            ) : (
              <p className="muted">{downloads ? t.host.soon : t.host.checking}</p>
            )}
            {platform.extra && (
              <a className="link-button" href={platform.extra.url}>
                {platform.extra.label}
              </a>
            )}
          </section>
        ))}
      </div>
    </Page>
  )
}

function HostDesktop() {
  const [state, setState] = useState<HostingState | null>(null)
  useEffect(() => {
    let stopListening: (() => void) | undefined
    let alive = true
    desktop
      .onHosting(setState)
      .then((unlisten) => {
        if (alive) stopListening = unlisten
        else unlisten()
      })
      .catch(console.error)
    desktop.hostingState().then(setState).catch(console.error)
    return () => {
      alive = false
      stopListening?.()
    }
  }, [])

  if (state === null) return null
  if (state.state === 'idle') return <Setup lastError={state.error} />
  if (state.state === 'starting') {
    return (
      <Page title={t.host.title}>
        <p className="muted" role="status">
          {t.host.starting(state.window.app)}
        </p>
      </Page>
    )
  }
  return <Live state={state} />
}

const SETTINGS_KEY = 'couchwarp.host'

interface Draft {
  title: string
  game: string
  maxPlayers: number
  public: boolean
  relayOnly: boolean
  turnMinutes: number | null
}

const DEFAULTS: Draft = {
  title: '',
  game: '',
  maxPlayers: 4,
  public: false,
  relayOnly: false,
  turnMinutes: null,
}

function savedDraft(): Draft {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

function Setup({ lastError }: { lastError: string | null }) {
  const { account } = useAccount()
  const prefs = usePreferences()
  const config = useServerConfig()
  const [draft, setDraft] = useState(savedDraft)
  const [chosen, setChosen] = useState<WindowInfo | null>(null)
  // A known game in the chosen window names the game and brings its cover.
  const known = useKnownGame(chosen?.app, chosen?.title)
  const [gameTouched, setGameTouched] = useState(false)
  const game = gameTouched || !known ? draft.game : known.name
  const [error, setError] = useState(lastError)
  const change = (patch: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...patch }))

  async function start(event: FormEvent) {
    event.preventDefault()
    if (!chosen) return
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(draft))
    } catch {
      // Remembering the settings is a convenience.
    }
    setError(null)
    try {
      await desktop.startHosting({
        windowId: chosen.id,
        title: draft.title || (account ? t.host.defaultTitle(account.displayName) : null),
        game: game || null,
        maxPlayers: draft.maxPlayers,
        public: draft.public && config?.publicRooms === true,
        relayOnly: draft.relayOnly && config?.relay !== false,
        turnMinutes: draft.turnMinutes,
        fps: prefs.hostFps,
        bitrateMbps: prefs.hostBitrate,
        maxHeight: prefs.hostMaxHeight,
        keepAwake: prefs.hostKeepAwake,
        focusLock: prefs.hostFocusLock,
        bubble: prefs.hostBubble,
        port: prefs.hostPort,
        stun: prefs.hostStun,
      })
    } catch (reason) {
      setError(String(reason))
    }
  }

  return (
    <Page title={t.host.title} lead={t.host.desktopLead}>
      {error && (
        <p className="notice" data-tone="error" role="alert">
          {error === 'window-gone' ? t.host.windowGone : error}
        </p>
      )}
      <form className="host-setup" onSubmit={start}>
        <WindowPicker chosen={chosen?.id ?? null} onChoose={setChosen} />
        <div className="host-setup__side">
          <Section title={t.host.roomTitle}>
            <div className="card stack">
              <div className="field">
                <label className="field__label" htmlFor="host-title">
                  {t.console.titleLabel}
                </label>
                <input
                  id="host-title"
                  className="input"
                  value={draft.title}
                  maxLength={MAX_TITLE_LENGTH}
                  placeholder={account ? t.host.defaultTitle(account.displayName) : ''}
                  onChange={(event) => change({ title: event.target.value })}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="host-game">
                  {t.console.gameLabel}
                </label>
                <input
                  id="host-game"
                  className="input"
                  value={game}
                  maxLength={MAX_TITLE_LENGTH}
                  onChange={(event) => {
                    setGameTouched(true)
                    change({ game: event.target.value })
                  }}
                  aria-describedby="host-game-help"
                />
                <p id="host-game-help" className="field__help">
                  {known && !gameTouched ? t.host.recognised : t.host.gameHelp}
                </p>
              </div>
              {chosen && <GameCover sources={[known?.header]} />}
              <div className="field">
                <label className="field__label" htmlFor="host-seats">
                  {t.console.seatsLabel}
                </label>
                <select
                  id="host-seats"
                  className="input"
                  value={draft.maxPlayers}
                  onChange={(event) => change({ maxPlayers: Number(event.target.value) })}
                >
                  {Array.from({ length: MAX_PLAYERS }, (_, index) => index + 1).map((seats) => (
                    <option key={seats} value={seats}>
                      {seats}
                    </option>
                  ))}
                </select>
              </div>
              {config?.publicRooms ? (
                <Choice<'link' | 'public'>
                  label={t.console.visibilityLabel}
                  value={draft.public ? 'public' : 'link'}
                  options={[
                    ['link', t.console.visibilityLink],
                    ['public', t.console.visibilityPublic],
                  ]}
                  onChange={(visibility) => change({ public: visibility === 'public' })}
                />
              ) : (
                <p className="field__help">{t.host.linkOnly}</p>
              )}
              {draft.public && config?.publicRooms && !account && (
                <p className="field__help">{t.host.publicNeedsAccount}</p>
              )}
              {draft.public && config?.publicRooms ? (
                <p className="field__help">
                  {config.relay ? t.console.relayPublic : t.console.relayMissing}
                </p>
              ) : (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.relayOnly}
                    disabled={config?.relay === false}
                    onChange={(event) => change({ relayOnly: event.target.checked })}
                  />
                  <span>
                    {t.console.relayLabel}
                    <span className="field__help">
                      {config?.relay === false ? t.console.relayMissing : t.console.relayHelp}
                    </span>
                  </span>
                </label>
              )}
            </div>
          </Section>
          <Section
            title={t.host.qualityTitle}
            actions={
              <Link to="/settings/host" className="link-button">
                {t.host.change}
              </Link>
            }
          >
            <p className="card card__text">
              {t.host.quality(prefs.hostMaxHeight, prefs.hostFps, prefs.hostBitrate)}
            </p>
          </Section>
          <button type="submit" className="button button--large" disabled={!chosen}>
            {chosen ? t.host.start : t.host.chooseFirst}
          </button>
        </div>
      </form>
    </Page>
  )
}

type Windows =
  | { kind: 'loading' }
  | { kind: 'failed'; reason: string }
  | { kind: 'ready'; list: WindowInfo[] }

function WindowPicker({
  chosen,
  onChoose,
}: {
  chosen: string | null
  onChoose(window: WindowInfo): void
}) {
  const [windows, setWindows] = useState<Windows>({ kind: 'loading' })
  const load = useCallback(() => {
    setWindows({ kind: 'loading' })
    desktop
      .listWindows()
      .then((list) => setWindows({ kind: 'ready', list }))
      .catch((reason) => setWindows({ kind: 'failed', reason: String(reason) }))
  }, [])
  useEffect(() => load(), [load])

  return (
    <Section
      title={t.host.windowTitle}
      actions={
        <button type="button" className="link-button" onClick={load}>
          <Icon name="refresh" size={16} />
          {t.host.refresh}
        </button>
      }
    >
      {windows.kind === 'loading' && (
        <p className="muted" role="status">
          {t.host.listing}
        </p>
      )}
      {windows.kind === 'failed' && (
        <div className="notice" data-tone="error">
          <p>{system === 'mac' ? t.host.screenPermission : windows.reason}</p>
          {system === 'mac' && (
            <button
              type="button"
              className="button button--small button--secondary"
              onClick={() => desktop.openPrivacySettings('screen')}
            >
              {t.host.openSettings}
            </button>
          )}
        </div>
      )}
      {windows.kind === 'ready' && windows.list.length === 0 && (
        <p className="muted">{t.host.noWindows}</p>
      )}
      {windows.kind === 'ready' && windows.list.length > 0 && (
        <fieldset className="windows">
          <legend className="visually-hidden">{t.host.windowTitle}</legend>
          {windows.list.map((window) => (
            <WindowChoice
              key={window.id}
              window={window}
              chosen={chosen === window.id}
              onChoose={() => onChoose(window)}
            />
          ))}
        </fieldset>
      )}
    </Section>
  )
}

function WindowChoice({
  window,
  chosen,
  onChoose,
}: {
  window: WindowInfo
  chosen: boolean
  onChoose(): void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    desktop
      .windowPreview(window.id)
      .then((picture) => alive && setPreview(picture))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [window.id])
  return (
    <label className="window-choice" data-chosen={chosen || undefined}>
      <input
        type="radio"
        name="window"
        className="visually-hidden"
        checked={chosen}
        onChange={onChoose}
      />
      <span className="window-choice__picture">
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <span className="window-choice__blank" aria-hidden="true">
            {window.app}
          </span>
        )}
      </span>
      <span className="window-choice__app">{window.app}</span>
      <span className="window-choice__title">{window.title || window.app}</span>
    </label>
  )
}

function Live({ state }: { state: Extract<HostingState, { state: 'live' }> }) {
  const [inputAllowed, setInputAllowed] = useState(!state.noInputPermission)
  // The room ends with the session: the hosting state turns idle on its own.
  const onEnd = useCallback(() => undefined, [])
  const stats = state.stats
  return (
    <Page
      title={t.host.liveTitle}
      lead={t.host.sharing(state.window.app, state.window.title)}
      actions={
        <ConfirmButton
          className="button button--danger"
          question={t.console.closeConfirm}
          confirmLabel={t.host.stop}
          onConfirm={() => desktop.stopHosting().catch(console.error)}
        >
          {t.host.stop}
        </ConfirmButton>
      }
    >
      <div className="live">
        <section className="card card--feature live__invite">
          <LiveCover window={state.window} />
          <p className="field__label">{t.host.codeLabel}</p>
          <p className="live__code">{state.code}</p>
          <InviteLink code={state.code} />
        </section>
        <dl className="stats">
          <Stat label={t.host.statGuests} value={stats ? String(stats.guests) : '0'} />
          <Stat label={t.host.statFps} value={stats ? stats.fps.toFixed(0) : '…'} />
          <Stat
            label={t.host.statDelay}
            value={stats ? t.host.ms(stats.medianMs.toFixed(1)) : '…'}
          />
          <Stat
            label={t.host.statBitrate}
            value={stats ? t.host.mbps(stats.bitrateMbps.toFixed(1)) : '…'}
          />
        </dl>
      </div>
      {!inputAllowed && (
        <div className="notice" data-tone="warning">
          <p>{system === 'linux' ? t.host.inputPermissionLinux : t.host.inputPermission}</p>
          <button
            type="button"
            className="button button--small button--secondary"
            onClick={() => {
              if (system === 'mac') desktop.openPrivacySettings('input').catch(console.error)
              desktop.inputAllowed().then(setInputAllowed).catch(console.error)
            }}
          >
            {system === 'mac' ? t.host.openSettings : t.host.checkAgain}
          </button>
        </div>
      )}
      {state.publicNeedsAccount && (
        <p className="notice" data-tone="warning">
          {t.host.publicNeedsAccount}
        </p>
      )}
      <RoomManager
        code={state.code}
        consoleKey={state.consoleKey}
        onEnd={onEnd}
        showClose={false}
      />
    </Page>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats__item">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  )
}

/** The shared game's picture, when the window is a known game. */
function LiveCover({ window }: { window: WindowInfo }) {
  const known = useKnownGame(window.app, window.title)
  return known ? <GameCover sources={[known.header]} className="live__cover" /> : null
}
