import type { HostCommand, RoomState } from '@couchwarp/protocol'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { ConfirmButton } from '../components/ConfirmButton'
import { MemberList } from '../components/MemberList'
import { t } from '../i18n'
import { ConsoleSession } from '../lib/console-session'
import { desktop, type HostingState } from '../lib/desktop'

type Live = Extract<HostingState, { state: 'live' }>

/**
 * The host's bubble, in its own small window over the game: the code and the guests at a
 * glance, the room's controls one press away. The desktop app opens and closes it.
 */
export function HostBubble() {
  const [hosting, setHosting] = useState<HostingState | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // The window is see-through around the bubble.
    document.documentElement.dataset.surface = 'bubble'
    let stop: (() => void) | undefined
    let alive = true
    desktop
      .onHosting(setHosting)
      .then((unlisten) => {
        if (alive) stop = unlisten
        else unlisten()
      })
      .catch(console.error)
    desktop.hostingState().then(setHosting).catch(console.error)
    return () => {
      alive = false
      stop?.()
    }
  }, [])

  const toggle = (next: boolean) => {
    setOpen(next)
    invoke('set_bubble_open', { open: next }).catch(console.error)
  }

  if (hosting?.state !== 'live') return null
  return open ? (
    <Panel live={hosting} onClose={() => toggle(false)} />
  ) : (
    <Pill live={hosting} onOpen={() => toggle(true)} />
  )
}

function Pill({ live, onOpen }: { live: Live; onOpen(): void }) {
  const guests = live.stats?.guests ?? 0
  return (
    <div className="host-pill">
      {/* The lights move the window; the rest of the pill opens the panel. */}
      <span className="host-pill__grip" data-tauri-drag-region title={t.bubble.move}>
        <i data-tauri-drag-region />
        <i data-tauri-drag-region />
        <i data-tauri-drag-region />
        <i data-tauri-drag-region />
      </span>
      <button type="button" className="host-pill__open" onClick={onOpen}>
        <span className="host-pill__code">{live.code}</span>
        <span className="host-pill__guests">{t.bubble.guests(guests)}</span>
      </button>
    </div>
  )
}

function Panel({ live, onClose }: { live: Live; onClose(): void }) {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [session, setSession] = useState<ConsoleSession | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const current = new ConsoleSession(live.code, live.consoleKey, {
      onRoom: setRoom,
      onChat: () => undefined,
      // The session ending closes this window from the app's side.
      onEnd: () => undefined,
    })
    setSession(current)
    return () => current.close()
  }, [live.code, live.consoleKey])

  const link = `${location.origin}/${live.code}`
  const command = (message: HostCommand) => session?.command(message)

  return (
    <div className="host-panel">
      <header className="host-panel__head" data-tauri-drag-region>
        <span className="host-pill__grip" data-tauri-drag-region>
          <i data-tauri-drag-region />
          <i data-tauri-drag-region />
          <i data-tauri-drag-region />
          <i data-tauri-drag-region />
        </span>
        <span className="host-panel__code" data-tauri-drag-region>
          {live.code}
        </span>
        <button type="button" className="link-button" onClick={onClose}>
          {t.bubble.close}
        </button>
      </header>

      <div className="host-panel__row">
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            navigator.clipboard
              .writeText(link)
              .then(() => setCopied(true))
              .catch(console.error)
          }}
        >
          {copied ? t.console.copied : t.bubble.copy}
        </button>
        {live.stats && (
          <span className="muted num">
            {t.bubble.stats(live.stats.fps.toFixed(0), live.stats.medianMs.toFixed(0))}
          </span>
        )}
      </div>

      <section className="host-panel__members" aria-label={t.room.membersTitle}>
        {room ? (
          <MemberList room={room} viewer="host" onCommand={command} />
        ) : (
          <p className="muted">{t.console.connecting}</p>
        )}
      </section>

      <footer className="host-panel__foot">
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => invoke('show_main_window').catch(console.error)}
        >
          {t.bubble.openApp}
        </button>
        <ConfirmButton
          className="button button--danger button--small"
          question={t.bubble.stopQuestion}
          confirmLabel={t.host.stop}
          onConfirm={() => desktop.stopHosting().catch(console.error)}
        >
          {t.host.stop}
        </ConfirmButton>
      </footer>
    </div>
  )
}
