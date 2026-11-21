import type { HostCommand, RoomState } from '@couchwarp/protocol'
import { t } from '../i18n'
import { Avatar } from './Avatar'

/**
 * People at the door, waiting for the host's yes. Nothing shows while no one waits.
 * `compact` for the host's bubble, where there is little room.
 */
export function DoorRequests({
  room,
  onCommand,
  compact = false,
}: {
  room: RoomState
  onCommand(command: HostCommand): void
  compact?: boolean
}) {
  if (room.waiting.length === 0) return null
  return (
    <section className="door" data-compact={compact || undefined} aria-labelledby="door-title">
      <h2 id="door-title" className="door__title">
        {t.door.title(room.waiting.length)}
      </h2>
      <ul className="door__list">
        {room.waiting.map((guest) => (
          <li key={guest.id} className="door__guest">
            <Avatar name={guest.name} url={guest.avatarUrl} />
            <span className="door__who">
              <span className="door__name">{guest.name}</span>
              <span className="door__detail">
                {guest.userId ? t.door.signedIn : t.door.anonymous}
              </span>
            </span>
            <span className="door__actions">
              <button
                type="button"
                className="button button--small"
                onClick={() => onCommand({ type: 'admit', guestId: guest.id, accept: true })}
              >
                {t.door.accept}
              </button>
              <button
                type="button"
                className="button button--small button--secondary"
                onClick={() => onCommand({ type: 'admit', guestId: guest.id, accept: false })}
              >
                {t.door.refuse}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
