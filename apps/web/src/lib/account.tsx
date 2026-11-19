import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

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
    const response = await fetch('/api/me')
    setAccount(response.ok ? await response.json() : null)
  }, [])

  const signOut = useCallback(async () => {
    await accountRequest('/api/auth/logout', 'POST')
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
    <AccountContext.Provider value={{ account, providers, refresh, signOut }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount(): AccountState {
  const state = useContext(AccountContext)
  if (!state) throw new Error('useAccount needs an AccountProvider above it')
  return state
}
