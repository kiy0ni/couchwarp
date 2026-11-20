import { type ReactNode, useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Link } from '../components/Link'
import { Page, Section } from '../components/Page'
import { Shell } from '../components/Shell'
import { t } from '../i18n'
import { useAccount } from '../lib/account'
import {
  askFriend,
  dropFriend,
  type Friend,
  type FriendLists,
  fetchFriends,
  type Person,
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
          <div className="columns">
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
                      />
                    ))}
                  </ul>
                </Section>
              )}
            </div>
            <div className="stack stack--loose">
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
              <section className="card">
                <h2 className="card__title">{t.friends.howTitle}</h2>
                <p className="card__text">{t.friends.how}</p>
              </section>
            </div>
          </div>
        )}
      </Page>
    </Shell>
  )
}

function FriendRow({ friend, onRemove }: { friend: Friend; onRemove(): void }) {
  const presence = friend.presence
  const where = presence?.title || presence?.game || ''
  return (
    <li className="people__item">
      <Avatar name={friend.displayName} url={friend.avatarUrl} />
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
        <button type="button" className="link-button" onClick={onRemove}>
          {t.friends.remove}
        </button>
      </span>
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
