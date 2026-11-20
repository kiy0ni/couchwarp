import {
  type ChatMessage,
  type HostCommand,
  type HotseatMode,
  MAX_PLAYERS,
  MAX_TITLE_LENGTH,
  type RoomSettings,
  type RoomState,
  type Visibility,
} from '@couchwarp/protocol'
import { type FormEvent, useEffect, useState } from 'react'
import { t } from '../i18n'
import { type ConsoleEnd, ConsoleSession } from '../lib/console-session'
import { ChatPanel } from './ChatPanel'
import { Choice } from './Choice'
import { MemberList } from './MemberList'
import { ReportDialog, type ReportTarget } from './ReportDialog'

const CHAT_KEPT = 100

interface Props {
  code: string
  consoleKey: string
  onEnd(reason: ConsoleEnd): void
  /** The desktop app stops the room with its own button. */
  showClose?: boolean
}

/**
 * Everything about a room except the game itself: who is in it, the chat, the settings.
 * The key proves this page belongs to the host; the host app gives it in its console link,
 * and the desktop app passes it straight in.
 */
export function RoomManager({ code, consoleKey: key, onEnd, showClose = true }: Props) {
  const [session, setSession] = useState<ConsoleSession | null>(null)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [reporting, setReporting] = useState<ReportTarget | null>(null)

  useEffect(() => {
    const current = new ConsoleSession(code, key, {
      onRoom: setRoom,
      onChat: (message) => setChat((previous) => [...previous, message].slice(-CHAT_KEPT)),
      onEnd,
    })
    setSession(current)
    return () => current.close()
  }, [code, key, onEnd])

  const command = (message: HostCommand) => session?.command(message)

  if (room === null) {
    return (
      <p className="muted" role="status">
        {t.console.connecting}
      </p>
    )
  }
  return (
    <div className="manager">
      <div className="manager__grid">
        <section className="card" aria-labelledby="console-members">
          <h2 id="console-members" className="card__title">
            {t.room.membersTitle}
          </h2>
          <MemberList
            room={room}
            viewer="host"
            onCommand={command}
            onReport={(member) => setReporting({ code, guestId: member.id, name: member.name })}
          />
          {room.settings.hotseat.mode !== 'off' && <Queue room={room} onCommand={command} />}
        </section>

        <section className="card" aria-labelledby="console-chat">
          <h2 id="console-chat" className="card__title">
            {t.room.chatTitle}
          </h2>
          <ChatPanel
            messages={chat}
            hostName={room.hostName}
            onSend={(text) => command({ type: 'chat', text })}
          />
        </section>
      </div>

      <section className="card" aria-labelledby="console-settings">
        <h2 id="console-settings" className="card__title">
          {t.console.settingsTitle}
        </h2>
        <SettingsForm room={room} onSave={(settings) => command({ type: 'configure', settings })} />
      </section>

      {showClose && (
        <section className="card" aria-labelledby="console-close">
          <h2 id="console-close" className="card__title">
            {t.console.closeTitle}
          </h2>
          <p className="card__text">{t.console.closeLead}</p>
          <div className="actions">
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                if (confirm(t.console.closeConfirm)) command({ type: 'close' })
              }}
            >
              {t.console.closeButton}
            </button>
          </div>
        </section>
      )}

      <ReportDialog target={reporting} onClose={() => setReporting(null)} />
    </div>
  )
}

/** The room's link, to copy and send to friends. */
export function InviteLink({ code }: { code: string }) {
  const link = `${location.origin}/${code}`
  const [copied, setCopied] = useState(false)
  return (
    <div className="field">
      <label className="field__label" htmlFor="invite-link">
        {t.console.inviteLabel}
      </label>
      <div className="invite">
        <input id="invite-link" className="input invite__link" value={link} readOnly />
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            navigator.clipboard
              .writeText(link)
              .then(() => setCopied(true))
              .catch((error) => console.error('Copy refused', error))
          }}
        >
          {copied ? t.console.copied : t.console.copy}
        </button>
      </div>
    </div>
  )
}

function Queue({ room, onCommand }: { room: RoomState; onCommand(command: HostCommand): void }) {
  const names = room.queue
    .map((id) => room.members.find((member) => member.id === id)?.name)
    .filter((name) => name !== undefined)
  return (
    <div className="stack">
      <h3 className="field__label">{t.console.queueTitle}</h3>
      {names.length === 0 ? (
        <p className="menu__note">{t.console.queueEmpty}</p>
      ) : (
        <ol className="queue">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ol>
      )}
      <div className="actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => onCommand({ type: 'next-turn' })}
        >
          {t.console.nextTurn}
        </button>
      </div>
    </div>
  )
}

interface SettingsProps {
  room: RoomState
  onSave(settings: RoomSettings): void
}

/** A draft of the settings; what the room server sends back replaces it once saved. */
function SettingsForm({ room, onSave }: SettingsProps) {
  const [draft, setDraft] = useState(room.settings)
  const [saved, setSaved] = useState(false)
  const [from, setFrom] = useState(room.settings)
  // New settings from the server (saved here or from the host app) reset the draft.
  if (from !== room.settings) {
    setFrom(room.settings)
    setDraft(room.settings)
  }
  const change = (patch: Partial<RoomSettings>) => {
    setDraft((previous) => ({ ...previous, ...patch }))
    setSaved(false)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    onSave(draft)
    setSaved(true)
  }

  return (
    <form className="stack console__form" onSubmit={submit}>
      <div className="field">
        <label className="field__label" htmlFor="room-title">
          {t.console.titleLabel}
        </label>
        <input
          id="room-title"
          className="input"
          value={draft.title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(event) => change({ title: event.target.value })}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="room-game">
          {t.console.gameLabel}
        </label>
        <input
          id="room-game"
          className="input"
          value={draft.game}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(event) => change({ game: event.target.value })}
          aria-describedby="room-game-help"
        />
        <p id="room-game-help" className="field__help">
          {t.console.gameHelp}
        </p>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="room-seats">
          {t.console.seatsLabel}
        </label>
        <select
          id="room-seats"
          className="input"
          value={draft.maxPlayers}
          onChange={(event) => change({ maxPlayers: Number(event.target.value) })}
          aria-describedby="room-seats-help"
        >
          {Array.from({ length: MAX_PLAYERS }, (_, index) => index + 1).map((seats) => (
            <option key={seats} value={seats}>
              {seats}
            </option>
          ))}
        </select>
        <p id="room-seats-help" className="field__help">
          {t.console.seatsHelp}
        </p>
      </div>

      <Choice<Visibility>
        label={t.console.visibilityLabel}
        value={draft.visibility}
        options={[
          ['link', t.console.visibilityLink],
          ['public', t.console.visibilityPublic],
        ]}
        onChange={(visibility) => change({ visibility })}
      />
      {room.publicRefused && <p className="menu__note">{t.console.refused[room.publicRefused]}</p>}

      <label className="check">
        <input
          type="checkbox"
          checked={draft.relayOnly}
          disabled={!room.relayAvailable}
          onChange={(event) => change({ relayOnly: event.target.checked })}
        />
        <span>
          {t.console.relayLabel}
          <span className="field__help">
            {room.relayAvailable ? t.console.relayHelp : t.console.relayMissing}
          </span>
        </span>
      </label>

      <Choice<HotseatMode>
        label={t.console.hotseatLabel}
        value={draft.hotseat.mode}
        options={[
          ['off', t.console.hotseatOff],
          ['manual', t.console.hotseatManual],
          ['timer', t.console.hotseatTimer],
        ]}
        onChange={(mode) => change({ hotseat: { ...draft.hotseat, mode } })}
      />
      {draft.hotseat.mode === 'timer' && (
        <div className="field">
          <label className="field__label" htmlFor="room-minutes">
            {t.console.minutesLabel}
          </label>
          <input
            id="room-minutes"
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={draft.hotseat.minutes}
            onChange={(event) =>
              change({
                hotseat: {
                  ...draft.hotseat,
                  minutes: Math.min(60, Math.max(1, Math.round(Number(event.target.value) || 1))),
                },
              })
            }
          />
        </div>
      )}

      <div className="actions">
        <button type="submit" className="button">
          {t.console.save}
        </button>
        {saved && (
          <p className="field__help" role="status">
            {t.console.saved}
          </p>
        )}
      </div>
    </form>
  )
}
