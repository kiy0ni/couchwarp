import { ROOM_CODE_LENGTH } from '@couchwarp/protocol'
import { type FormEvent, useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { CodeEntry } from '../components/CodeEntry'
import { Link } from '../components/Link'
import { Page, Section } from '../components/Page'
import { PlayerBadge } from '../components/PlayerBadge'
import { RoomCard } from '../components/RoomCard'
import { Shell } from '../components/Shell'
import { t } from '../i18n'
import { useAccount } from '../lib/account'
import { isDesktop } from '../lib/desktop'
import { fetchRooms, type RoomCard as Room } from '../lib/directory'
import { type Friend, fetchFriends } from '../lib/friends'
import { padName } from '../lib/gamepads'
import { playedOn, useHistory } from '../lib/history'
import { navigate } from '../lib/router'
import { isRoomOpen } from '../lib/session'
import { useGamepads } from '../lib/use-gamepads'

const SHOWN_ROOMS = 3
const SHOWN_GAMES = 5
const SHOWN_FRIENDS = 6
const FRIENDS_REFRESH_MS = 30_000

/** Where everything starts: join with a code, host, and what friends are doing. */
export function Home({ onFound }: { onFound(code: string): void }) {
  const { account } = useAccount()
  return (
    <Shell>
      <Page
        title={account ? t.home.greeting(account.displayName) : t.home.welcome}
        lead={t.home.lead}
      >
        <div className="dashboard">
          <div className="dashboard__main">
            <JoinCard onFound={onFound} />
            <RecentGames />
            <PublicRooms />
          </div>
          <div className="dashboard__side">
            <HostCard />
            <FriendsCard />
            <ControllersCard />
          </div>
        </div>
      </Page>
    </Shell>
  )
}

type Status = { kind: 'idle' } | { kind: 'looking' } | { kind: 'error'; message: string }

function JoinCard({ onFound }: { onFound(code: string): void }) {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const gamepads = useGamepads()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (code.length < ROOM_CODE_LENGTH) {
      setStatus({ kind: 'error', message: t.home.incomplete })
      return
    }
    setStatus({ kind: 'looking' })
    try {
      if (await isRoomOpen(code)) onFound(code)
      else setStatus({ kind: 'error', message: t.home.notFound })
    } catch (error) {
      console.error(error)
      setStatus({ kind: 'error', message: t.home.serverDown })
    }
  }

  const error = status.kind === 'error' ? status.message : null
  return (
    <form className="card card--feature join-card" onSubmit={submit} noValidate>
      <h2 className="card__title">{t.home.title}</h2>
      <div className="field">
        <label className="field__label" htmlFor="room-code">
          {t.home.codeLabel}
        </label>
        <CodeEntry
          id="room-code"
          value={code}
          onChange={(next) => {
            setCode(next)
            if (status.kind === 'error') setStatus({ kind: 'idle' })
          }}
          invalid={error !== null}
          describedBy="room-code-help"
        />
        <p id="room-code-help" className="field__help" data-error={error ? true : undefined}>
          {error ?? (gamepads.length > 0 ? t.home.gamepadHelp : t.home.codeHelp)}
        </p>
      </div>
      <button type="submit" className="button" disabled={status.kind === 'looking'}>
        {status.kind === 'looking' ? t.home.looking : t.home.join}
      </button>
    </form>
  )
}

function HostCard() {
  return (
    <section className="card">
      <h2 className="card__title">{t.home.hostTitle}</h2>
      <p className="card__text">{isDesktop ? t.home.hostDesktop : t.home.hostWeb}</p>
      <Link to="/heberger" className="button button--secondary">
        {isDesktop ? t.home.hostAction : t.home.downloadAction}
      </Link>
    </section>
  )
}

function FriendsCard() {
  const { account } = useAccount()
  const [friends, setFriends] = useState<Friend[] | null>(null)
  useEffect(() => {
    if (!account) return
    const load = () =>
      fetchFriends()
        .then((lists) => setFriends(lists.friends))
        .catch(() => setFriends([]))
    load()
    const timer = window.setInterval(load, FRIENDS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [account])

  if (account === undefined) return null
  if (account === null) {
    return (
      <section className="card">
        <h2 className="card__title">{t.friends.title}</h2>
        <p className="card__text">{t.friends.signedOut}</p>
        <Link to="/parametres" className="button button--secondary">
          {t.account.signIn}
        </Link>
      </section>
    )
  }
  // Friends in a game first; the server already sorts by name.
  const shown = [...(friends ?? [])]
    .sort((a, b) => Number(b.presence !== null) - Number(a.presence !== null))
    .slice(0, SHOWN_FRIENDS)
  return (
    <section className="card">
      <header className="card__head">
        <h2 className="card__title">{t.friends.title}</h2>
        <Link to="/amis" className="link-button">
          {t.home.seeAll}
        </Link>
      </header>
      {friends !== null && shown.length === 0 && <p className="card__text">{t.friends.empty}</p>}
      {shown.length > 0 && (
        <ul className="people">
          {shown.map((friend) => (
            <li key={friend.userId} className="people__item">
              <Avatar name={friend.displayName} url={friend.avatarUrl} />
              <span className="people__who">
                <span className="people__name">{friend.displayName}</span>
                <span className="people__status" data-online={friend.presence ? true : undefined}>
                  {friend.presence === null
                    ? t.friends.offline
                    : friend.presence.hosting
                      ? t.friends.hosting(friend.presence.title || friend.presence.game)
                      : t.friends.playing(friend.presence.title || friend.presence.game)}
                </span>
              </span>
              {friend.presence?.roomCode && (
                <Link to={`/${friend.presence.roomCode}`} className="button button--small">
                  {t.friends.join}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ControllersCard() {
  const gamepads = useGamepads()
  return (
    <section className="card">
      <header className="card__head">
        <h2 className="card__title">{t.home.controllersTitle}</h2>
        <Link to="/parametres/manettes" className="link-button">
          {t.home.test}
        </Link>
      </header>
      {gamepads.length === 0 ? (
        <p className="card__text">{t.home.noController}</p>
      ) : (
        <ul className="people">
          {gamepads.map((gamepad, index) => (
            <li key={gamepad.index} className="people__item">
              <PlayerBadge slot={index + 1} />
              <span className="people__name">{padName(gamepad)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RecentGames() {
  const { account } = useAccount()
  const games = useHistory(account)
  if (!account || !games || games.length === 0) return null
  // One row per room: the newest visit.
  const rooms = games.filter(
    (game, index) => games.findIndex((other) => other.roomCode === game.roomCode) === index,
  )
  return (
    <Section title={t.home.recentTitle}>
      <ul className="list">
        {rooms.slice(0, SHOWN_GAMES).map((game) => (
          <li key={`${game.roomCode}-${game.joinedAt}`} className="list__item">
            <span className="list__main">
              <span className="list__title">{game.title || game.game || game.roomCode}</span>
              <span className="list__detail">
                {game.hostName ? t.browse.hostedBy(game.hostName) : game.roomCode}
              </span>
            </span>
            <time className="list__detail" dateTime={new Date(game.joinedAt).toISOString()}>
              {playedOn.format(game.joinedAt)}
            </time>
            <button
              type="button"
              className="button button--small button--secondary"
              onClick={() => navigate(`/${game.roomCode}`)}
            >
              {t.home.rejoin}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function PublicRooms() {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    fetchRooms({ game: '', continent: '', freeSeats: false }, abort.signal)
      .then(setRooms)
      .catch(() => {
        if (!abort.signal.aborted) setRooms([])
      })
    return () => abort.abort()
  }, [])
  return (
    <Section
      title={t.browse.title}
      actions={
        <Link to="/parties" className="link-button">
          {t.home.seeAll}
        </Link>
      }
    >
      {rooms !== null && rooms.length === 0 && <p className="muted">{t.home.noPublic}</p>}
      {rooms !== null && rooms.length > 0 && (
        <ul className="rooms">
          {rooms.slice(0, SHOWN_ROOMS).map((room) => (
            <li key={room.code}>
              <RoomCard room={room} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
