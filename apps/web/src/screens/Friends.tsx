import { type ReactNode, useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Footer } from '../components/Footer'
import { TopBar } from '../components/TopBar'
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
import { useGamepadNavigation } from '../lib/gamepad-nav'
import { navigate } from '../lib/router'

const REFRESH_MS = 30_000

/** Friends first, with what they are playing, then requests. */
export function Friends() {
  const { account } = useAccount()
  const [lists, setLists] = useState<FriendLists | null>(null)
  useGamepadNavigation(true, () => navigate('/'))

  useEffect(() => {
    if (!account) return
    const load = () => fetchFriends().then(setLists).catch(console.error)
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [account])

  const act = (change: Promise<FriendLists>) => change.then(setLists).catch(console.error)

  return (
    <main className="screen">
      <TopBar />
      <section className="panel" aria-labelledby="friends-title">
        <h1 id="friends-title" className="title">
          {t.friends.title}
        </h1>
        {account === null && <p className="panel__lead">{t.friends.signedOut}</p>}
        {lists && (
          <>
            {lists.friends.length === 0 ? (
              <p className="panel__lead">{t.friends.empty}</p>
            ) : (
              <ul className="members">
                {lists.friends.map((friend) => (
                  <FriendRow
                    key={friend.userId}
                    friend={friend}
                    onRemove={() => act(dropFriend(friend.userId))}
                  />
                ))}
              </ul>
            )}
            <Requests
              title={t.friends.incomingTitle}
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
          </>
        )}
      </section>
      <Footer />
    </main>
  )
}

function FriendRow({ friend, onRemove }: { friend: Friend; onRemove(): void }) {
  const presence = friend.presence
  const where = presence?.title || presence?.game || ''
  return (
    <li className="members__item">
      <Avatar name={friend.displayName} url={friend.avatarUrl} />
      <span className="members__who">
        <span className="members__name">{friend.displayName}</span>
        <span className="members__role" data-online={presence ? true : undefined}>
          {presence === null
            ? t.friends.offline
            : presence.hosting
              ? t.friends.hosting(where)
              : t.friends.playing(where)}
        </span>
      </span>
      <span className="members__actions">
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
  people: Person[]
  actions(person: Person): ReactNode
}

function Requests({ title, people, actions }: RequestsProps) {
  if (people.length === 0) return null
  return (
    <section className="stack">
      <h2 className="section-title">{title}</h2>
      <ul className="members">
        {people.map((person) => (
          <li key={person.userId} className="members__item">
            <Avatar name={person.displayName} url={person.avatarUrl} />
            <span className="members__who">
              <span className="members__name">{person.displayName}</span>
            </span>
            <span className="members__actions">{actions(person)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
