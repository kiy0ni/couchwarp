import type { MouseEvent, ReactNode } from 'react'
import { t } from '../i18n'
import { useAccount } from '../lib/account'
import { navigate } from '../lib/router'
import { Wordmark } from './Wordmark'

function go(path: string) {
  return (event: MouseEvent) => {
    event.preventDefault()
    navigate(path)
  }
}

/** The wordmark, the page's own actions, then the account. */
export function TopBar({ children }: { children?: ReactNode }) {
  const { account } = useAccount()
  return (
    <header className="topbar">
      <Wordmark onClick={go('/')} />
      <nav className="topbar__actions">
        {children}
        {account === null && (
          <a className="link-button" href="/compte" onClick={go('/compte')}>
            {t.account.signIn}
          </a>
        )}
        {account && (
          <a
            className="account-chip"
            href="/compte"
            onClick={go('/compte')}
            title={t.account.title}
          >
            {account.avatarUrl ? (
              <img src={account.avatarUrl} alt="" width={28} height={28} />
            ) : (
              <span aria-hidden="true">{account.displayName.charAt(0).toUpperCase()}</span>
            )}
            <span className="account-chip__name">{account.displayName}</span>
          </a>
        )}
      </nav>
    </header>
  )
}
