import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { adoptAppSession, desktop, isDesktop } from './desktop'

export type ProviderId = 'discord' | 'google'

export interface Account {
  id: string
  displayName: string
  avatarUrl: string | null
  ageConfirmed: boolean
  isAdmin: boolean
  identities: { provider: ProviderId; username: string }[]
}

interface AccountState {
  /** Undefined while loading, null for a guest. */
  account: Account | null | undefined
  providers: ProviderId[]
  refresh(): Promise<void>
  /** In a browser, leaves for the provider's page; in the desktop app, opens the browser. */
  signIn(provider: ProviderId): Promise<void>
  signOut(): Promise<void>
}

const AccountContext = createContext<AccountState | null>(null)

/** Requests that change the account; the server also checks the Origin header. */
export function accountRequest(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** Where a sign-in button sends the browser: the provider, then back to this page. */
export function signInUrl(provider: ProviderId, options: { link?: boolean } = {}): string {
  const params = new URLSearchParams({ return_to: location.pathname })
  if (options.link) params.set('link', '1')
  return `/api/auth/${provider}/start?${params}`
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [providers, setProviders] = useState<ProviderId[]>([])

  const refresh = useCallback(async () => {
    let response = await fetch('/api/me')
    // The desktop app may have signed in before this window had a session of its own.
    if (response.status === 401 && isDesktop) {
      const token = await desktop.savedSession()
      if (token && (await adoptAppSession(token))) response = await fetch('/api/me')
    }
    setAccount(response.ok ? await response.json() : null)
  }, [])

  const signIn = useCallback(
    async (provider: ProviderId) => {
      if (!isDesktop) {
        location.assign(signInUrl(provider))
        return
      }
      const token = await desktop.signIn(provider)
      await adoptAppSession(token)
      await refresh()
    },
    [refresh],
  )

  const signOut = useCallback(async () => {
    await accountRequest('/api/auth/logout', 'POST')
    if (isDesktop) await desktop.signOut()
    setAccount(null)
  }, [])

  useEffect(() => {
    refresh().catch(() => setAccount(null))
    fetch('/api/auth/providers')
      .then((response) => response.json() as Promise<{ providers: ProviderId[] }>)
      .then(({ providers }) => setProviders(providers))
      // Without the list, sign-in buttons stay hidden and guests play as usual.
      .catch(() => setProviders([]))
  }, [refresh])

  return (
    <AccountContext.Provider value={{ account, providers, refresh, signIn, signOut }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount(): AccountState {
  const state = useContext(AccountContext)
  if (!state) throw new Error('useAccount needs an AccountProvider above it')
  return state
}
