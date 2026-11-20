import type { HostCommand, RoomState } from '@couchwarp/protocol'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ConfirmButton } from '../components/ConfirmButton'
import { Icon } from '../components/Icon'
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
  const [direction, setDirection] = useState<'down' | 'up'>('down')

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
    // The app places the window and says which way the panel unfolds; apps before 0.1.1
    // answer nothing and always unfold downward.
    invoke<'down' | 'up' | null>('set_bubble_open', { open: next })
      .then((way) => setDirection(way === 'up' ? 'up' : 'down'))
      .catch(console.error)
  }

  if (hosting?.state !== 'live') return null
  return open ? (
    <Panel live={hosting} direction={direction} onClose={() => toggle(false)} />
  ) : (
    <Pill live={hosting} onOpen={() => toggle(true)} />
  )
}

/** Past this many pixels, a press on the logo moves the window instead of opening it. */
const DRAG_THRESHOLD = 4

/** Closed, the bubble is only the logo and how many guests are in. */
function Pill({ live, onOpen }: { live: Live; onOpen(): void }) {
  const guests = live.stats?.guests ?? 0
  const press = useRef<{ x: number; y: number } | null>(null)
  return (
    <button
      type="button"
      className="host-pill"
      aria-label={t.bubble.open(live.code, guests)}
      onPointerDown={(event) => {
        press.current = { x: event.screenX, y: event.screenY }
      }}
      onPointerMove={(event) => {
        const start = press.current
        if (!start) return
        if (Math.hypot(event.screenX - start.x, event.screenY - start.y) < DRAG_THRESHOLD) return
        press.current = null
        // The system moves the window from here; the click that follows is not a press.
        getCurrentWindow().startDragging().catch(console.error)
      }}
      onPointerUp={() => {
        if (press.current) onOpen()
        press.current = null
      }}
    >
      <span className="host-pill__grip" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {guests > 0 && (
        <span className="count" aria-hidden="true">
          {guests}
        </span>
      )}
    </button>
  )
}

/**
 * The open bubble. Unfolding upward, from a pill low on the screen, it is laid out bottom
 * first: the code and the close button stay where the pill was.
 */
function Panel({
  live,
  direction,
  onClose,
}: {
  live: Live
  direction: 'down' | 'up'
  onClose(): void
}) {
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
    <div className="host-panel" data-direction={direction}>
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
        {room === null && <p className="muted">{t.console.connecting}</p>}
        {room && room.members.length === 0 && <p className="muted">{t.room.nobody}</p>}
        {room && room.members.length > 0 && (
          <ul className="people">
            {room.members.map((member) => (
              <li key={member.id} className="people__item host-panel__guest">
                <Avatar name={member.name} url={member.avatarUrl} />
                <span className="people__who">
                  <span className="people__name">{member.name}</span>
                  <span className="people__status">{t.room.roles[member.role]}</span>
                </span>
                {member.role !== 'spectator' &&
                  (['keyboard', 'mouse'] as const).map((input) => (
                    <button
                      key={input}
                      type="button"
                      className="input-toggle"
                      aria-pressed={member[input]}
                      title={t.bubble.allow[input]}
                      onClick={() =>
                        command({
                          type: 'set-permissions',
                          guestId: member.id,
                          keyboard: input === 'keyboard' ? !member.keyboard : member.keyboard,
                          mouse: input === 'mouse' ? !member.mouse : member.mouse,
                        })
                      }
                    >
                      <Icon name={input} size={18} />
                      <span className="visually-hidden">{t.bubble.allow[input]}</span>
                    </button>
                  ))}
              </li>
            ))}
          </ul>
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
