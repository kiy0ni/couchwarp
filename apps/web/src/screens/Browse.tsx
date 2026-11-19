import { useEffect, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { t } from '../i18n'
import { fetchRooms, type RoomCard, type RoomFilters } from '../lib/directory'
import { useGamepadNavigation } from '../lib/gamepad-nav'
import { navigate } from '../lib/router'

const REFRESH_MS = 30_000
/** Wait for a pause in typing before asking the server. */
const TYPING_MS = 300
const LIGHTS = 4

type Listing = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; rooms: RoomCard[] }

/** Public rooms, refreshed every half minute, filtered by game, region and free seats. */
export function Browse() {
  const [filters, setFilters] = useState<RoomFilters>({ game: '', continent: '', freeSeats: false })
  const [listing, setListing] = useState<Listing>({ kind: 'loading' })
  useGamepadNavigation(true, () => navigate('/'))

  useEffect(() => {
    const abort = new AbortController()
    const load = () =>
      fetchRooms(filters, abort.signal)
        .then((rooms) => setListing({ kind: 'ready', rooms }))
        .catch((error) => {
          if (abort.signal.aborted) return
          console.error(error)
          setListing({ kind: 'failed' })
        })
    const first = window.setTimeout(load, TYPING_MS)
    const refresh = window.setInterval(load, REFRESH_MS)
    return () => {
      abort.abort()
      window.clearTimeout(first)
      window.clearInterval(refresh)
    }
  }, [filters])

  const change = (patch: Partial<RoomFilters>) =>
    setFilters((previous) => ({ ...previous, ...patch }))

  return (
    <main className="screen">
      <TopBar />
      <div className="browse">
        <h1 className="title">{t.browse.title}</h1>
        <form className="browse__filters" onSubmit={(event) => event.preventDefault()}>
          <div className="field">
            <label className="field__label" htmlFor="filter-game">
              {t.browse.gameLabel}
            </label>
            <input
              id="filter-game"
              className="input"
              type="search"
              value={filters.game}
              placeholder={t.browse.gamePlaceholder}
              onChange={(event) => change({ game: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="filter-region">
              {t.browse.regionLabel}
            </label>
            <select
              id="filter-region"
              className="input"
              value={filters.continent}
              onChange={(event) => change({ continent: event.target.value })}
            >
              <option value="">{t.browse.anywhere}</option>
              {Object.entries(t.browse.continents).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <label className="check browse__free">
            <input
              type="checkbox"
              checked={filters.freeSeats}
              onChange={(event) => change({ freeSeats: event.target.checked })}
            />
            {t.browse.freeSeats}
          </label>
        </form>

        {listing.kind === 'loading' && (
          <p className="panel__lead" role="status">
            {t.browse.loading}
          </p>
        )}
        {listing.kind === 'failed' && <p className="panel__lead">{t.browse.failed}</p>}
        {listing.kind === 'ready' && listing.rooms.length === 0 && (
          <p className="panel__lead">{t.browse.empty}</p>
        )}
        {listing.kind === 'ready' && listing.rooms.length > 0 && (
          <ul className="rooms">
            {listing.rooms.map((room) => (
              <li key={room.code}>
                <Card room={room} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

function Card({ room }: { room: RoomCard }) {
  const free = Math.max(0, room.maxPlayers - room.players)
  return (
    <a
      className="room-card"
      href={`/${room.code}`}
      aria-label={t.browse.join(room.title)}
      onClick={(event) => {
        event.preventDefault()
        navigate(`/${room.code}`)
      }}
    >
      <span className="room-card__picture">
        {room.thumbnailUrl ? (
          <img src={room.thumbnailUrl} alt="" loading="lazy" width={320} height={180} />
        ) : (
          <span className="room-card__blank" aria-hidden="true">
            {room.game || room.title}
          </span>
        )}
        <span className="room-card__proximity" data-proximity={room.proximity}>
          {t.browse.proximity[room.proximity]}
        </span>
      </span>
      <span className="room-card__body">
        <span className="room-card__title">{room.title}</span>
        {room.game && <span className="room-card__game">{room.game}</span>}
        <span className="room-card__host">{t.browse.hostedBy(room.hostName)}</span>
        <span className="room-card__seats">
          <span className="seats" aria-hidden="true">
            {room.avatars.map((avatar, index) => (
              <Seat
                // biome-ignore lint/suspicious/noArrayIndexKey: seats have no identity but their place
                key={index}
                player={index + 1}
                avatar={avatar}
              />
            ))}
            {Array.from({ length: free }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: empty seats are interchangeable
              <i key={`free-${index}`} className="seats__free" />
            ))}
          </span>
          <span>{t.browse.seats(room.players, room.maxPlayers)}</span>
          {room.spectators > 0 && (
            <span className="room-card__watching">{t.browse.watching(room.spectators)}</span>
          )}
        </span>
      </span>
    </a>
  )
}

/** An occupied seat: the player's avatar, ringed in the colour of their light. */
function Seat({ player, avatar }: { player: number; avatar: string | null }) {
  const light = ((player - 1) % LIGHTS) + 1
  return avatar ? (
    <img className="seats__taken" data-player={light} src={avatar} alt="" width={24} height={24} />
  ) : (
    <i className="seats__taken" data-player={light} />
  )
}
