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
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [failed, setFailed] = useState(false)
  if (!update) return null

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
