import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { type AvailableUpdate, desktop, isDesktop, type UpdateProgress } from '../lib/desktop'
import { Icon } from './Icon'

/**
 * In the desktop app, a small green button in the top bar while a newer version waits.
 * One click downloads it, installs it and restarts the app; nothing shows otherwise.
 */
export function UpdateButton() {
  const update = useAvailableUpdate()
  const { progress, failed, install, label } = useInstall()
  if (!update) return null
  return (
    <button
      type="button"
      className="topbar__update"
      data-failed={failed || undefined}
      disabled={progress !== null}
      title={failed ? t.update.failed : t.update.hint(update.version)}
      onClick={install}
    >
      <Icon name="download" size={18} weight="bold" />
      <span className="topbar__update-label" aria-live="polite">
        {label}
      </span>
    </button>
  )
}

/** Installing the waiting version, and what to call the button meanwhile. */
function useInstall() {
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [failed, setFailed] = useState(false)

  async function install() {
    setFailed(false)
    setProgress({ step: 'downloading', done: 0, total: null })
    try {
      // On success the app restarts, so this page never sees the promise settle.
      await desktop.installUpdate(setProgress)
    } catch (error) {
      console.error(error)
      setFailed(true)
      setProgress(null)
    }
  }

  const label = failed
    ? t.update.retry
    : progress === null
      ? t.update.action
      : progress.step === 'installing'
        ? t.update.restarting
        : progress.total
          ? t.update.downloading(Math.min(99, Math.floor((progress.done / progress.total) * 100)))
          : t.update.downloadingUnknown
  return { progress, failed, install, label }
}

type Check =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'failed' }
  /** An app from before 0.2.5 cannot look on demand: it looks as it starts. */
  | { kind: 'older' }
  | { kind: 'found'; update: AvailableUpdate }

/**
 * The app's version in the settings, and a button to look for a newer one now rather than
 * wait for the next look in the background. What it finds can be installed from here.
 */
export function VersionCheck() {
  const [version, setVersion] = useState<string | null>(null)
  // Apps before 0.2.5 have neither the version nor the look on demand.
  const [older, setOlder] = useState(false)
  const [check, setCheck] = useState<Check>({ kind: 'idle' })
  const waiting = useAvailableUpdate()
  const { progress, failed, install, label } = useInstall()
  useEffect(() => {
    desktop
      .appVersion()
      .then(setVersion)
      .catch(() => setOlder(true))
  }, [])

  async function look() {
    setCheck({ kind: 'checking' })
    if (older) {
      // What the app found as it started, if anything.
      const update = await desktop.updateAvailable().catch(() => null)
      setCheck(update ? { kind: 'found', update } : { kind: 'older' })
      return
    }
    try {
      const update = await desktop.checkForUpdate()
      setCheck(update ? { kind: 'found', update } : { kind: 'latest' })
    } catch (error) {
      console.error(error)
      setCheck({ kind: 'failed' })
    }
  }

  const found = check.kind === 'found' ? check.update : waiting
  const status = found
    ? t.update.available(found.version)
    : check.kind === 'latest'
      ? t.update.latest
      : check.kind === 'failed'
        ? t.update.checkFailed
        : check.kind === 'older'
          ? t.update.olderApp
          : null
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__title">{t.settings.desktopApp}</span>
        <p className="setting__help" aria-live="polite">
          {version ? t.settings.version(version) : older ? t.update.olderVersion : '…'}
          {status && ` · ${status}`}
        </p>
      </div>
      <div className="setting__control">
        {found ? (
          <button
            type="button"
            className="button button--small"
            data-failed={failed || undefined}
            disabled={progress !== null}
            onClick={install}
          >
            <Icon name="download" size={16} weight="bold" />
            {label}
          </button>
        ) : (
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={check.kind === 'checking'}
            onClick={look}
          >
            {check.kind === 'checking' ? t.update.checking : t.update.check}
          </button>
        )}
      </div>
    </div>
  )
}

/** The version the app found waiting: asked once, then told when a later look finds one. */
function useAvailableUpdate(): AvailableUpdate | null {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null)
  useEffect(() => {
    if (!isDesktop) return
    let stop: (() => void) | undefined
    let alive = true
    desktop
      .onUpdate(setUpdate)
      .then((unlisten) => {
        if (alive) stop = unlisten
        else unlisten()
      })
      .catch(console.error)
    // An app from before updates existed has no such command: the button stays hidden.
    desktop
      .updateAvailable()
      .then((found) => {
        if (alive && found) setUpdate(found)
      })
      .catch(() => {})
    return () => {
      alive = false
      stop?.()
    }
  }, [])
  return update
}
