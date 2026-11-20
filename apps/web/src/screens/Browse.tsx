import { useEffect, useState } from 'react'
import { Page } from '../components/Page'
import { RoomCard } from '../components/RoomCard'
import { Shell } from '../components/Shell'
import { t } from '../i18n'
import { fetchRooms, type RoomCard as Room, type RoomFilters } from '../lib/directory'
import { navigate } from '../lib/router'

const REFRESH_MS = 30_000
/** Wait for a pause in typing before asking the server. */
const TYPING_MS = 300

type Listing = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; rooms: Room[] }

/** Public rooms, refreshed every half minute, filtered by game, region and free seats. */
export function Browse() {
  const [filters, setFilters] = useState<RoomFilters>({ game: '', continent: '', freeSeats: false })
  const [listing, setListing] = useState<Listing>({ kind: 'loading' })

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
    <Shell onBack={() => navigate('/')}>
      <Page title={t.browse.title} lead={t.browse.lead}>
        <form className="toolbar" onSubmit={(event) => event.preventDefault()}>
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
          <label className="check toolbar__check">
            <input
              type="checkbox"
              checked={filters.freeSeats}
              onChange={(event) => change({ freeSeats: event.target.checked })}
            />
            {t.browse.freeSeats}
          </label>
        </form>

        {listing.kind === 'loading' && (
          <p className="muted" role="status">
            {t.browse.loading}
          </p>
        )}
        {listing.kind === 'failed' && <p className="muted">{t.browse.failed}</p>}
        {listing.kind === 'ready' && listing.rooms.length === 0 && (
          <section className="card card--feature empty">
            <h2 className="card__title">{t.browse.emptyTitle}</h2>
            <p className="card__text">{t.browse.empty}</p>
          </section>
        )}
        {listing.kind === 'ready' && listing.rooms.length > 0 && (
          <ul className="rooms">
            {listing.rooms.map((room) => (
              <li key={room.code}>
                <RoomCard room={room} />
              </li>
            ))}
          </ul>
        )}
      </Page>
    </Shell>
  )
}
