import { type ReactNode, useEffect, useState } from 'react'
import { t } from '../i18n'
import { type Account, useAccount } from '../lib/account'
import { isDesktop, system } from '../lib/desktop'
import { fetchFriends } from '../lib/friends'
import { useGamepadNavigation } from '../lib/gamepad-nav'
import { usePath } from '../lib/router'
import { Avatar } from './Avatar'
import { Icon, type IconName } from './Icon'
import { Link } from './Link'
import { Wordmark } from './Wordmark'

const REQUESTS_REFRESH_MS = 60_000

interface Destination {
  to: string
  icon: IconName
  label: string
  /** A number next to the label, such as friend requests waiting. */
  count?: number
}

/**
 * Every page but the game: the navigation on the left from a laptop, at the bottom on a
 * phone, and the page in the middle. A controller moves through both.
 */
export function Shell({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  const path = usePath()
  const { account } = useAccount()
  const requests = useFriendRequests(account)
  useGamepadNavigation(true, onBack)

  const destinations: Destination[] = [
    { to: '/', icon: 'home', label: t.nav.home },
    { to: '/parties', icon: 'rooms', label: t.nav.rooms },
    { to: '/heberger', icon: 'host', label: t.nav.host },
    { to: '/amis', icon: 'friends', label: t.nav.friends, count: requests },
    { to: '/parametres', icon: 'settings', label: t.nav.settings },
  ]
  const admin: Destination = { to: '/moderation', icon: 'shield', label: t.nav.moderation }
  const current = (to: string) =>
    to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`)

  return (
    <div className="shell" data-system={isDesktop ? system : undefined}>
      <a className="skip-link" href="#main">
        {t.nav.skip}
      </a>
      <aside className="sidebar">
        {/* In the desktop app the window is dragged by this strip. */}
        <div className="sidebar__brand" data-tauri-drag-region>
          <Wordmark />
        </div>
        <nav className="sidebar__nav" aria-label={t.nav.label}>
          {[...destinations, ...(account?.isAdmin ? [admin] : [])].map((destination) => (
            <NavItem
              key={destination.to}
              destination={destination}
              current={current(destination.to)}
            />
          ))}
        </nav>
        <div className="sidebar__foot">
          <AccountButton account={account} />
          <div className="sidebar__legal">
            <Link to="/conditions">{t.footer.terms}</Link>
            <Link to="/confidentialite">{t.footer.privacy}</Link>
          </div>
        </div>
      </aside>

      <header className="mobilebar">
        <Wordmark />
        <AccountButton account={account} compact />
      </header>

      <main id="main" className="shell__main" tabIndex={-1}>
        {children}
      </main>

      <nav className="tabbar" aria-label={t.nav.label}>
        {destinations.map((destination) => (
          <NavItem
            key={destination.to}
            destination={destination}
            current={current(destination.to)}
            tab
          />
        ))}
      </nav>
    </div>
  )
}

function NavItem({
  destination,
  current,
  tab = false,
}: {
  destination: Destination
  current: boolean
  tab?: boolean
}) {
  const { to, icon, label, count } = destination
  return (
    <Link
      to={to}
      className={tab ? 'tabbar__item' : 'nav-item'}
      aria-current={current ? 'page' : undefined}
    >
      <Icon name={icon} size={tab ? 22 : 20} />
      <span className={tab ? 'tabbar__label' : 'nav-item__label'}>{label}</span>
      {count ? (
        <>
          <span className="count" aria-hidden="true">
            {count}
          </span>
          <span className="visually-hidden">{t.nav.waiting(count)}</span>
        </>
      ) : null}
    </Link>
  )
}

function AccountButton({
  account,
  compact = false,
}: {
  account: Account | null | undefined
  compact?: boolean
}) {
  if (account === undefined) return <span className="account-button" aria-hidden="true" />
  if (account === null) {
    return (
      <Link to="/parametres" className="button button--secondary button--small">
        {t.account.signIn}
      </Link>
    )
  }
  return (
    <Link to="/parametres" className="account-button" title={t.account.title}>
      <Avatar name={account.displayName} url={account.avatarUrl} />
      {!compact && (
        <span className="account-button__text">
          <span className="account-button__name">{account.displayName}</span>
          <span className="account-button__hint">{t.nav.accountHint}</span>
        </span>
      )}
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
