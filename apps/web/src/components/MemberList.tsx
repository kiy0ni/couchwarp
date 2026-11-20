import type { HostCommand, Member, RoomState } from '@couchwarp/protocol'
import { useState } from 'react'
import { t } from '../i18n'
import { useAccount } from '../lib/account'
import { askFriend } from '../lib/friends'
import { Avatar } from './Avatar'
import { ConfirmButton } from './ConfirmButton'

/** Who looks at the list: the host (console), a moderator, or anyone else. */
export type Viewer = 'host' | 'moderator' | 'guest'

interface Props {
  room: RoomState
  viewer: Viewer
  /** The guest looking at the list, to mark them and keep actions off themselves. */
  selfId?: number | null
  onCommand(command: HostCommand): void
  /** Without it, the list offers no report: the host's bubble sends people to the app. */
  onReport?(member: Member): void
}

/** Everyone in the room, players first, with what the viewer may do to each. */
export function MemberList({ room, viewer, selfId = null, onCommand, onReport }: Props) {
  const { account } = useAccount()
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set())
  if (room.members.length === 0) return <p className="menu__note">{t.room.nobody}</p>
  const seated = room.members.filter((member) => member.role !== 'spectator').length
  const seatsLeft = room.settings.maxPlayers - seated
  const ordered = [...room.members].sort(
    (a, b) => Number(a.role === 'spectator') - Number(b.role === 'spectator'),
  )

  return (
    <ul className="members">
      {ordered.map((member) => (
        <li key={member.id} className="members__item">
          <Avatar name={member.name} url={member.avatarUrl} />
          <span className="members__who">
            <span className="members__name">
              {member.name} {member.id === selfId && t.room.you}
            </span>
            <span className="members__role">{t.room.roles[member.role]}</span>
          </span>
          {member.id !== selfId && mayActOn(viewer, member) && (
            <MemberActions
              member={member}
              viewer={viewer}
              seatsLeft={seatsLeft}
              onCommand={onCommand}
            />
          )}
          {member.id !== selfId && (
            <span className="members__actions">
              {account && member.userId && member.userId !== account.id && (
                <button
                  type="button"
                  className="link-button"
                  disabled={asked.has(member.userId)}
                  onClick={() => {
                    const userId = member.userId as string
                    askFriend(userId)
                      .then(() => setAsked((previous) => new Set(previous).add(userId)))
                      .catch(console.error)
                  }}
                >
                  {asked.has(member.userId) ? t.friends.added : t.friends.add}
                </button>
              )}
              {onReport && (
                <button type="button" className="link-button" onClick={() => onReport(member)}>
                  {t.report.open}
                </button>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function mayActOn(viewer: Viewer, member: Member): boolean {
  if (viewer === 'host') return true
  return viewer === 'moderator' && member.role !== 'moderator'
}

interface ActionsProps {
  member: Member
  viewer: Viewer
  seatsLeft: number
  onCommand(command: HostCommand): void
}

function MemberActions({ member, viewer, seatsLeft, onCommand }: ActionsProps) {
  const guestId = member.id
  const setRole = (role: Member['role']) => onCommand({ type: 'set-role', guestId, role })
  return (
    <fieldset className="members__actions">
      <legend className="visually-hidden">{t.room.actionsFor(member.name)}</legend>
      {member.role === 'spectator' ? (
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={seatsLeft <= 0}
          onClick={() => setRole('player')}
        >
          {t.room.seat}
        </button>
      ) : (
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => setRole('spectator')}
        >
          {t.room.unseat}
        </button>
      )}
      {viewer === 'host' && member.role !== 'spectator' && (
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => setRole(member.role === 'moderator' ? 'player' : 'moderator')}
        >
          {member.role === 'moderator' ? t.room.removeModerator : t.room.makeModerator}
        </button>
      )}
      {viewer === 'host' && (
        <label className="members__toggle">
          <input
            type="checkbox"
            checked={member.keyboard}
            onChange={(event) =>
              onCommand({
                type: 'set-permissions',
                guestId,
                keyboard: event.target.checked,
                mouse: member.mouse,
              })
            }
          />
          {t.room.keyboardAllowed}
        </label>
      )}
      {viewer === 'host' && (
        <label className="members__toggle">
          <input
            type="checkbox"
            checked={member.mouse}
            onChange={(event) =>
              onCommand({
                type: 'set-permissions',
                guestId,
                keyboard: member.keyboard,
                mouse: event.target.checked,
              })
            }
          />
          {t.room.mouseAllowed}
        </label>
      )}
      <button
        type="button"
        className="link-button"
        onClick={() => onCommand({ type: 'kick', guestId, ban: false })}
      >
        {t.room.kick}
      </button>
      <ConfirmButton
        className="link-button link-button--danger"
        question={t.room.banConfirm(member.name)}
        confirmLabel={t.room.ban}
        onConfirm={() => onCommand({ type: 'kick', guestId, ban: true })}
      >
        {t.room.ban}
      </ConfirmButton>
    </fieldset>
  )
}
