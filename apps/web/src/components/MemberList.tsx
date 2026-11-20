import type { GuestRole, HostCommand, Member, RoomState } from '@couchwarp/protocol'
import { useRef, useState } from 'react'
import { t } from '../i18n'
import { useAccount } from '../lib/account'
import { askFriend } from '../lib/friends'
import { fetchProfile, type PublicProfile } from '../lib/profile'
import { Avatar } from './Avatar'
import { Badges } from './Badges'
import { ConfirmButton } from './ConfirmButton'
import { Icon } from './Icon'
import { Link } from './Link'
import { SettingRow, Switch } from './SettingRow'

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

/**
 * Everyone in the room, players first. Each row says what the person can use; Manage
 * opens one small window with their place, their inputs and the rest.
 */
export function MemberList({ room, viewer, selfId = null, onCommand, onReport }: Props) {
  if (room.members.length === 0) return <p className="menu__note">{t.room.nobody}</p>
  const seated = room.members.filter((member) => member.role !== 'spectator').length
  const seatsLeft = room.settings.maxPlayers - seated
  const ordered = [...room.members].sort(
    (a, b) => Number(a.role === 'spectator') - Number(b.role === 'spectator'),
  )

  return (
    <ul className="members">
      {ordered.map((member) => (
        <MemberRow
          key={member.id}
          member={member}
          viewer={viewer}
          self={member.id === selfId}
          seatsLeft={seatsLeft}
          onCommand={onCommand}
          onReport={onReport}
        />
      ))}
    </ul>
  )
}

function mayActOn(viewer: Viewer, member: Member): boolean {
  if (viewer === 'host') return true
  return viewer === 'moderator' && member.role !== 'moderator'
}

interface RowProps {
  member: Member
  viewer: Viewer
  self: boolean
  seatsLeft: number
  onCommand(command: HostCommand): void
  onReport: ((member: Member) => void) | undefined
}

function MemberRow({ member, viewer, self, seatsLeft, onCommand, onReport }: RowProps) {
  const { account } = useAccount()
  const [asked, setAsked] = useState(false)
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const open = () => {
    dialog.current?.showModal()
    if (member.userId && !profile) {
      fetchProfile(member.userId).then(setProfile).catch(console.error)
    }
  }
  const guestId = member.id
  const manage = !self && mayActOn(viewer, member)
  const befriend = !self && account && member.userId && member.userId !== account.id
  const report = !self ? onReport : undefined
  const hasMenu = manage || befriend || report !== undefined

  const setRole = (role: GuestRole) => onCommand({ type: 'set-role', guestId, role })
  const setInputs = (keyboard: boolean, mouse: boolean) =>
    onCommand({ type: 'set-permissions', guestId, keyboard, mouse })
  const titleId = `member-${member.id}`
  const roles: readonly GuestRole[] =
    viewer === 'host' ? ['player', 'moderator', 'spectator'] : ['player', 'spectator']

  return (
    <li className="members__item">
      <Avatar name={member.name} url={member.avatarUrl} />
      <span className="members__who">
        <span className="members__name">
          {member.name} {self && t.room.you}
        </span>
        <span className="members__role">{t.room.roles[member.role]}</span>
      </span>
      {member.role !== 'spectator' && <Inputs member={member} />}
      {hasMenu && (
        <button type="button" className="button button--secondary button--small" onClick={open}>
          {manage ? t.room.manage : t.room.more}
        </button>
      )}

      {hasMenu && (
        <dialog ref={dialog} className="menu member-dialog" aria-labelledby={titleId}>
          <div className="friend-dialog__head">
            <Avatar name={member.name} url={member.avatarUrl} color={profile?.color} size={48} />
            <span className="friend-dialog__who">
              <h2 id={titleId} className="menu__title">
                {member.name}
              </h2>
              {profile && <Badges badges={profile.badges} />}
            </span>
          </div>

          {manage && (
            <fieldset className="choice choice--column">
              <legend className="choice__label">{t.room.placeTitle}</legend>
              {roles.map((role) => (
                <label key={role} className="choice__option choice__option--described">
                  <input
                    type="radio"
                    name={`${titleId}-role`}
                    checked={member.role === role}
                    disabled={role !== 'spectator' && member.role === 'spectator' && seatsLeft <= 0}
                    onChange={() => setRole(role)}
                  />
                  <span>
                    {t.room.places[role]}
                    <span className="field__help">{t.room.placesHelp[role]}</span>
                  </span>
                </label>
              ))}
              {member.role === 'spectator' && seatsLeft <= 0 && (
                <p className="field__help">{t.room.noSeat}</p>
              )}
            </fieldset>
          )}

          {manage && viewer === 'host' && member.role !== 'spectator' && (
            <div className="settings__rows">
              <div className="setting">
                <div className="setting__text">
                  <span className="setting__title">{t.friends.pad}</span>
                  <p className="setting__help">{t.friends.padHelp}</p>
                </div>
                <div className="setting__control">
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked
                    aria-checked
                    disabled
                    aria-label={t.friends.pad}
                  />
                </div>
              </div>
              <SettingRow
                id={`${titleId}-keyboard`}
                title={t.friends.inputs.keyboard}
                help={t.friends.inputsHelp.keyboard}
              >
                <Switch
                  id={`${titleId}-keyboard`}
                  checked={member.keyboard}
                  onChange={(keyboard) => setInputs(keyboard, member.mouse)}
                />
              </SettingRow>
              <SettingRow
                id={`${titleId}-mouse`}
                title={t.friends.inputs.mouse}
                help={t.friends.inputsHelp.mouse}
              >
                <Switch
                  id={`${titleId}-mouse`}
                  checked={member.mouse}
                  onChange={(mouse) => setInputs(member.keyboard, mouse)}
                />
              </SettingRow>
            </div>
          )}

          <div className="menu__actions">
            <button type="button" className="button" onClick={() => dialog.current?.close()}>
              {t.friends.done}
            </button>
            {befriend && (
              <button
                type="button"
                className="button button--secondary"
                disabled={asked}
                onClick={() =>
                  askFriend(member.userId as string)
                    .then(() => setAsked(true))
                    .catch(console.error)
                }
              >
                {asked ? t.friends.added : t.friends.add}
              </button>
            )}
            {manage && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  dialog.current?.close()
                  onCommand({ type: 'kick', guestId, ban: false })
                }}
              >
                {t.room.kick}
              </button>
            )}
            {manage && (
              <ConfirmButton
                className="button button--danger"
                question={t.room.banConfirm(member.name)}
                confirmLabel={t.room.ban}
                onConfirm={() => {
                  dialog.current?.close()
                  onCommand({ type: 'kick', guestId, ban: true })
                }}
              >
                {t.room.ban}
              </ConfirmButton>
            )}
            {member.userId && (
              <Link to={`/profile/${member.userId}`} className="link-button">
                {t.profilePage.view}
              </Link>
            )}
            {report && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  dialog.current?.close()
                  report(member)
                }}
              >
                {t.report.open}
              </button>
            )}
          </div>
        </dialog>
      )}
    </li>
  )
}

/** What a player can use, at a glance: the controller always, keyboard and mouse if allowed. */
function Inputs({ member }: { member: Member }) {
  const allowed = [
    t.friends.pad,
    ...(member.keyboard ? [t.friends.inputs.keyboard] : []),
    ...(member.mouse ? [t.friends.inputs.mouse] : []),
  ]
  return (
    <span className="members__inputs" title={allowed.join(', ')}>
      <span className="visually-hidden">{t.room.canUse(allowed.join(', '))}</span>
      <Icon name="pad" size={18} />
      {member.keyboard && <Icon name="keyboard" size={18} />}
      {member.mouse && <Icon name="mouse" size={18} />}
    </span>
  )
}
