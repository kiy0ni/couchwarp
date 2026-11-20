import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ConfirmButton } from '../components/ConfirmButton'
import { Link } from '../components/Link'
import { Page, Section } from '../components/Page'
import { SettingRow, Switch } from '../components/SettingRow'
import { Shell } from '../components/Shell'
import { t } from '../i18n'
import { useAccount } from '../lib/account'
import {
  askByTag,
  askFriend,
  dropFriend,
  type Friend,
  type FriendLists,
  fetchFriends,
  fullTag,
  type Permissions,
  type Person,
  setPermissions,
} from '../lib/friends'
import { navigate } from '../lib/router'

const REFRESH_MS = 30_000

/** Friends first, with what they are playing, then requests. */
export function Friends() {
  const { account } = useAccount()
  const [lists, setLists] = useState<FriendLists | null>(null)

  useEffect(() => {
    if (!account) return
    const load = () => fetchFriends().then(setLists).catch(console.error)
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [account])

  const act = (change: Promise<FriendLists>) => change.then(setLists).catch(console.error)

  const playing = lists?.friends.filter((friend) => friend.presence !== null) ?? []
  const away = lists?.friends.filter((friend) => friend.presence === null) ?? []

  return (
    <Shell onBack={() => navigate('/')}>
      <Page title={t.friends.title} lead={t.friends.lead}>
        {account === null && (
          <section className="card card--feature stack">
            <p className="card__text">{t.friends.signedOut}</p>
            <div className="actions">
              <Link to="/parametres" className="button">
                {t.account.signIn}
              </Link>
            </div>
          </section>
        )}
        {lists && (
          <div className="columns columns--action-first">
            <div className="stack stack--loose">
              {lists.friends.length === 0 && (
                <section className="card card--feature">
                  <p className="card__text">{t.friends.empty}</p>
                </section>
              )}
              {playing.length > 0 && (
                <Section title={t.friends.playingTitle(playing.length)}>
                  <ul className="people people--card">
                    {playing.map((friend) => (
                      <FriendRow
                        key={friend.userId}
                        friend={friend}
                        onRemove={() => act(dropFriend(friend.userId))}
                        onPermissions={(permissions) =>
                          act(setPermissions(friend.userId, permissions))
                        }
                      />
                    ))}
                  </ul>
                </Section>
              )}
              {away.length > 0 && (
                <Section title={t.friends.awayTitle(away.length)}>
                  <ul className="people people--card">
                    {away.map((friend) => (
                      <FriendRow
                        key={friend.userId}
                        friend={friend}
                        onRemove={() => act(dropFriend(friend.userId))}
                        onPermissions={(permissions) =>
                          act(setPermissions(friend.userId, permissions))
                        }
                      />
                    ))}
                  </ul>
                </Section>
              )}
            </div>
            <div className="stack stack--loose">
              <AddFriend onAdded={setLists} />
              <Requests
                title={t.friends.incomingTitle}
                empty={t.friends.noIncoming}
                people={lists.incoming}
                actions={(person) => (
                  <>
                    <button
                      type="button"
                      className="button button--small"
                      onClick={() => act(askFriend(person.userId))}
                    >
                      {t.friends.accept}
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => act(dropFriend(person.userId))}
                    >
                      {t.friends.decline}
                    </button>
                  </>
                )}
              />
              {lists.outgoing.length > 0 && (
                <Requests
                  title={t.friends.outgoingTitle}
                  people={lists.outgoing}
                  actions={(person) => (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => act(dropFriend(person.userId))}
                    >
                      {t.friends.cancel}
                    </button>
                  )}
                />
              )}
            </div>
          </div>
        )}
      </Page>
    </Shell>
  )
}

function FriendRow({
  friend,
  onRemove,
  onPermissions,
}: {
  friend: Friend
  onRemove(): void
  onPermissions(permissions: Permissions): void
}) {
  const presence = friend.presence
  const where = presence?.title || presence?.game || ''
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <li className="people__item">
      <Avatar name={friend.displayName} url={friend.avatarUrl} color={friend.color} />
      <span className="people__who">
        <span className="people__name">{friend.displayName}</span>
        <span className="people__status" data-online={presence ? true : undefined}>
          {presence === null
            ? t.friends.offline
            : presence.hosting
              ? t.friends.hosting(where)
              : t.friends.playing(where)}
        </span>
      </span>
      <span className="people__actions">
        {presence?.roomCode && (
          <button
            type="button"
            className="button button--small"
            onClick={() => navigate(`/${presence.roomCode}`)}
          >
            {t.friends.join}
          </button>
        )}
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => dialog.current?.showModal()}
        >
          {t.friends.manage}
        </button>
      </span>
      <dialog
        ref={dialog}
        className="menu friend-dialog"
        aria-labelledby={`friend-${friend.userId}`}
      >
        <div className="friend-dialog__head">
          <Avatar name={friend.displayName} url={friend.avatarUrl} color={friend.color} />
          <h2 id={`friend-${friend.userId}`} className="menu__title">
            {friend.displayName}
          </h2>
        </div>
        <p className="menu__note">{t.friends.permissionsLead}</p>
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
          {(['keyboard', 'mouse'] as const).map((input) => (
            <SettingRow
              key={input}
              id={`friend-${friend.userId}-${input}`}
              title={t.friends.inputs[input]}
              help={t.friends.inputsHelp[input]}
            >
              <Switch
                id={`friend-${friend.userId}-${input}`}
                checked={friend.permissions[input]}
                onChange={(checked) => onPermissions({ ...friend.permissions, [input]: checked })}
              />
            </SettingRow>
          ))}
        </div>
        <div className="menu__actions">
          <button type="button" className="button" onClick={() => dialog.current?.close()}>
            {t.friends.done}
          </button>
          <ConfirmButton
            className="button button--danger"
            question={t.friends.removeQuestion(friend.displayName)}
            confirmLabel={t.friends.remove}
            onConfirm={() => {
              dialog.current?.close()
              onRemove()
            }}
          >
            {t.friends.remove}
          </ConfirmButton>
        </div>
      </dialog>
    </li>
  )
}

interface RequestsProps {
  title: string
  /** Shown when nobody is waiting; without it, the block hides. */
  empty?: string
  people: Person[]
  actions(person: Person): ReactNode
}

function Requests({ title, empty, people, actions }: RequestsProps) {
  if (people.length === 0 && !empty) return null
  return (
    <Section title={title}>
      {people.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="people people--card">
          {people.map((person) => (
            <li key={person.userId} className="people__item">
              <Avatar name={person.displayName} url={person.avatarUrl} />
              <span className="people__who">
                <span className="people__name">{person.displayName}</span>
              </span>
              <span className="people__actions">{actions(person)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** Add someone by name and tag, the way they read it on their own profile. */
function AddFriend({ onAdded }: { onAdded(lists: FriendLists): void }) {
  const { account } = useAccount()
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const mine = account ? fullTag(account.displayName, account.tag) : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    const result = await askByTag(value)
    if (result.ok) {
      onAdded(result.lists)
      setValue('')
      setStatus({ ok: true, text: t.friends.sent })
    } else {
      const reasons = t.friends.addErrors
      setStatus({
        ok: false,
        text: reasons[result.reason as keyof typeof reasons] ?? reasons.failed,
      })
    }
  }

  return (
    <section className="card stack">
      <h2 className="card__title">{t.friends.addTitle}</h2>
      <p className="card__text">{t.friends.addLead}</p>
      <form className="add-friend" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="add-friend">
          {t.friends.addLabel}
        </label>
        <input
          id="add-friend"
          className="input"
          value={value}
          placeholder={t.friends.addPlaceholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value)
            setStatus(null)
          }}
        />
        <button type="submit" className="button" disabled={!/#\d{6}$/.test(value.trim())}>
          {t.friends.addButton}
        </button>
      </form>
      {status && (
        <p className="field__help" data-error={status.ok ? undefined : true} role="status">
          {status.text}
        </p>
      )}
      {mine && (
        <div className="my-tag">
          <span className="muted">{t.friends.yourTag}</span>
          <code className="my-tag__value">{mine}</code>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() =>
              navigator.clipboard
                .writeText(mine)
                .then(() => setCopied(true))
                .catch(console.error)
            }
          >
            {copied ? t.console.copied : t.console.copy}
          </button>
        </div>
      )}
    </section>
  )
}
