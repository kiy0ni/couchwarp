import { isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { t } from '../i18n'
import { type Account, useAccount } from '../lib/account'
import { isDesktop, system } from '../lib/desktop'
import { fetchFriends } from '../lib/friends'
import { useGamepadNavigation } from '../lib/gamepad-nav'
import { navigate, usePath } from '../lib/router'
import { Avatar } from './Avatar'
import { Icon, type IconName } from './Icon'
import { Link } from './Link'
import { Wordmark } from './Wordmark'

const REQUESTS_REFRESH_MS = 60_000

interface Destination {
  to: string
  icon: IconName
  label: string
  /** The player light that marks this place when it is open, 1 to 4. */
  tone: 1 | 2 | 3 | 4 | 0
}

/**
 * Every page but the game. From a laptop: a rail of places on the left, the account at
 * the top and a bar to join with a code at the bottom. On a phone: tabs at the bottom.
 * A controller moves through all of it.
 */
export function Shell({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  const path = usePath()
  const { account } = useAccount()
  const requests = useFriendRequests(account)
  useGamepadNavigation(true, onBack)

  const destinations: Destination[] = [
    { to: '/', icon: 'home', label: t.nav.home, tone: 1 },
    { to: '/parties', icon: 'rooms', label: t.nav.rooms, tone: 2 },
    { to: '/heberger', icon: 'host', label: t.nav.host, tone: 3 },
    { to: '/amis', icon: 'friends', label: t.nav.friends, tone: 4 },
    { to: '/parametres', icon: 'settings', label: t.nav.settings, tone: 0 },
  ]
  const admin: Destination = { to: '/moderation', icon: 'shield', label: t.nav.moderation, tone: 0 }
  const current = (to: string) =>
    to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`)

  return (
    <div className="shell" data-system={isDesktop ? system : undefined}>
      <a className="skip-link" href="#main">
        {t.nav.skip}
      </a>
      <nav className="rail" aria-label={t.nav.label}>
        {/* In the desktop app the window is dragged by its edges and this strip. */}
        <div className="rail__brand" data-tauri-drag-region>
          <Link to="/" className="rail__mark" aria-label={t.wordmark}>
            <i />
            <i />
            <i />
            <i />
          </Link>
        </div>
        <div className="rail__places">
          {destinations.map((destination) => (
            <RailItem
              key={destination.to}
              destination={destination}
              current={current(destination.to)}
            />
          ))}
        </div>
        {account?.isAdmin && (
          <div className="rail__foot">
            <RailItem destination={admin} current={current(admin.to)} />
          </div>
        )}
      </nav>

      <div className="shell__body">
        <header className="topbar" data-tauri-drag-region>
          <span className="topbar__brand">
            <Wordmark />
          </span>
          <span className="topbar__end">
            {requests > 0 && (
              <Link to="/amis" className="topbar__requests">
                <Icon name="friends" size={18} />
                <span className="count" aria-hidden="true">
                  {requests}
                </span>
                <span className="visually-hidden">{t.nav.waiting(requests)}</span>
              </Link>
            )}
            <AccountButton account={account} />
          </span>
        </header>

        <main id="main" className="shell__main" tabIndex={-1}>
          {children}
        </main>

        {path !== '/' && <JoinBar />}
      </div>

      <nav className="tabbar" aria-label={t.nav.label}>
        {destinations.map((destination) => (
          <Link
            key={destination.to}
            to={destination.to}
            className="tabbar__item"
            data-tone={destination.tone}
            aria-current={current(destination.to) ? 'page' : undefined}
          >
            <Icon name={destination.icon} size={22} />
            <span className="tabbar__label">{destination.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}

function RailItem({ destination, current }: { destination: Destination; current: boolean }) {
  return (
    <Link
      to={destination.to}
      className="rail__item"
      data-tone={destination.tone}
      aria-current={current ? 'page' : undefined}
    >
      <Icon name={destination.icon} size={22} />
      <span className="rail__label">{destination.label}</span>
    </Link>
  )
}

/** Join from anywhere: a code, or a whole invitation link pasted as is. */
function JoinBar() {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    const code = codeFrom(value)
    if (!code) {
      setInvalid(true)
      return
    }
    setValue('')
    navigate(`/${code}`)
  }

  return (
    <form className="joinbar" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="joinbar-code">
        {t.nav.joinLabel}
      </label>
      <input
        id="joinbar-code"
        className="input joinbar__input"
        value={value}
        placeholder={t.nav.joinPlaceholder}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'joinbar-error' : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setValue(event.target.value)
          setInvalid(false)
        }}
      />
      {invalid && (
        <span id="joinbar-error" className="joinbar__error" role="status">
          {t.nav.joinInvalid}
        </span>
      )}
      <button type="submit" className="button button--small" disabled={!value.trim()}>
        {t.home.join}
      </button>
    </form>
  )
}

/** The room code in what was typed: the code itself, or the end of an invitation link. */
export function codeFrom(text: string): string | null {
  const last = text.trim().replace(/\/+$/, '').split('/').pop() ?? ''
  const code = normalizeRoomCode(last.split(/[?#]/)[0] ?? '')
  return isRoomCode(code) ? code : null
}

function AccountButton({ account }: { account: Account | null | undefined }) {
  if (account === undefined) return <span className="account-button" aria-hidden="true" />
  if (account === null) {
    return (
      <Link to="/parametres/compte" className="button button--secondary button--small">
        {t.account.signIn}
      </Link>
    )
  }
  return (
    <Link to="/parametres/compte" className="account-button" title={t.account.title}>
      <Avatar name={account.displayName} url={account.avatarUrl} />
      <span className="account-button__name">{account.displayName}</span>
    </Link>
  )
}

/** Friend requests waiting for an answer, checked now and then while signed in. */
function useFriendRequests(account: Account | null | undefined): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!account) {
      setCount(0)
      return
    }
    const load = () =>
      fetchFriends()
        .then((lists) => setCount(lists.incoming.length))
        .catch(() => setCount(0))
    load()
    const timer = window.setInterval(load, REQUESTS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [account])
  return count
}
