import { ROOM_CODE_LENGTH } from '@couchwarp/protocol'
import { type FormEvent, useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { CodeEntry } from '../components/CodeEntry'
import { GameCover } from '../components/GameCover'
import { Icon } from '../components/Icon'
import { Link } from '../components/Link'
import { Page, Section } from '../components/Page'
import { PlayerBadge } from '../components/PlayerBadge'
import { RoomCard } from '../components/RoomCard'
import { Shell } from '../components/Shell'
import { t } from '../i18n'
import { useAccount } from '../lib/account'
import { desktop, type HostingState, isDesktop } from '../lib/desktop'
import { fetchRooms, type RoomCard as Room } from '../lib/directory'
import { type Friend, fetchFriends } from '../lib/friends'
import { padName } from '../lib/gamepads'
import { useKnownGame } from '../lib/games'
import { byRoom, playedOn, useHistory } from '../lib/history'
import { navigate } from '../lib/router'
import { isRoomOpen } from '../lib/session'
import { useGamepads } from '../lib/use-gamepads'

const SHOWN_ROOMS = 3
const SHOWN_GAMES = 5
const SHOWN_FRIENDS = 6
const FRIENDS_REFRESH_MS = 30_000

/** Where everything starts: this computer, a code to join, controllers, then friends. */
export function Home({ onFound }: { onFound(code: string): void }) {
  const { account } = useAccount()
  return (
    <Shell>
      <Page
        title={account ? t.home.greeting(account.displayName) : t.home.welcome}
        lead={t.home.lead}
      >
        <div className="machines">
          <JoinCard onFound={onFound} />
          <ThisComputer />
          <ControllersCard />
        </div>
        <FriendsPlaying />
        <div className="columns">
          <RecentGames />
          <PublicRooms />
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
    <form className="card join-card" onSubmit={submit} noValidate>
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

/** The machine this page runs on: share a game from it, or get the app that can. */
/** A phone or a tablet, which cannot host: hosting is for the computer that runs the game. */
const phone =
  typeof matchMedia === 'function' &&
  matchMedia('(any-pointer: coarse)').matches &&
  !matchMedia('(any-pointer: fine)').matches

function ThisComputer() {
  const hosting = useHostingState()
  const live = hosting?.state === 'live' ? hosting : null
  const known = useKnownGame(live?.window.app, live?.window.title)
  return (
    <section className="card machine">
      {live ? (
        <GameCover sources={[known?.header]} />
      ) : (
        <span className="machine__icon">
          <Icon name="computer" size={44} weight="duotone" />
        </span>
      )}
      <div className="machine__text">
        <h2 className="card__title">{phone ? t.home.hostTitle : t.home.thisComputer}</h2>
        <p className="card__text">
          {live
            ? t.home.liveNow(live.code, live.stats?.guests ?? 0)
            : isDesktop
              ? t.home.hostDesktop
              : phone
                ? t.home.hostPhone
                : t.home.hostWeb}
        </p>
      </div>
      <Link to="/host" className={live || phone ? 'button button--secondary' : 'button'}>
        {live
          ? t.home.manage
          : isDesktop
            ? t.home.hostAction
            : phone
              ? t.home.hostPhoneAction
              : t.home.downloadAction}
      </Link>
    </section>
  )
}

/** In the desktop app, the hosting state, kept up to date; null elsewhere. */
function useHostingState(): HostingState | null {
  const [state, setState] = useState<HostingState | null>(null)
  useEffect(() => {
    if (!isDesktop) return
    let stop: (() => void) | undefined
    let alive = true
    desktop
      .onHosting(setState)
      .then((unlisten) => {
        if (alive) stop = unlisten
        else unlisten()
      })
      .catch(console.error)
    desktop.hostingState().then(setState).catch(console.error)
    return () => {
      alive = false
      stop?.()
    }
  }, [])
  return state
}

/** Friends in a game right now, as cards to join; the rest are on the Friends page. */
function FriendsPlaying() {
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
  const playing = (friends ?? []).filter((friend) => friend.presence !== null)
  return (
    <Section
      title={t.home.friendsTitle}
      actions={
        account && (
          <Link to="/friends" className="link-button">
            {t.home.seeAll}
          </Link>
        )
      }
    >
      {friends !== null && playing.length === 0 ? (
        <p className="muted">{friends.length === 0 ? t.friends.empty : t.home.nobodyPlaying}</p>
      ) : (
        <ul className="friend-cards">
          {playing.slice(0, SHOWN_FRIENDS).map((friend) => (
            <li key={friend.userId} className="card friend-card">
              <Avatar name={friend.displayName} url={friend.avatarUrl} color={friend.color} />
              <span className="friend-card__who">
                <span className="people__name">{friend.displayName}</span>
                <span className="people__status" data-online>
                  {friend.presence?.hosting
                    ? t.friends.hosting(friend.presence.title || friend.presence.game)
                    : t.friends.playing(friend.presence?.title || friend.presence?.game || '')}
                </span>
              </span>
              {friend.presence?.roomCode ? (
                <Link to={`/${friend.presence.roomCode}`} className="button button--small">
                  {t.friends.join}
                </Link>
              ) : (
                <span className="muted friend-card__note">{t.home.askCode}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function ControllersCard() {
  const gamepads = useGamepads()
  return (
    <section className="card">
      <header className="card__head">
        <h2 className="card__title">{t.home.controllersTitle}</h2>
        <Link to="/settings/controllers" className="link-button">
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
  const rooms = byRoom(games)
  return (
    <Section
      title={t.home.recentTitle}
      actions={
        rooms.length > SHOWN_GAMES && (
          <Link to="/settings/account" className="link-button">
            {t.common.seeAll}
          </Link>
        )
      }
    >
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
        <Link to="/rooms" className="link-button">
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
