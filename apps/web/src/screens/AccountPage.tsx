import { useState } from 'react'
import { TopBar } from '../components/TopBar'
import { t } from '../i18n'
import {
  type Account,
  accountRequest,
  type ProviderId,
  signInUrl,
  useAccount,
} from '../lib/account'
import { useGamepadNavigation } from '../lib/gamepad-nav'
import { navigate } from '../lib/router'

const PROVIDER_NAMES: Record<ProviderId, string> = { discord: 'Discord', google: 'Google' }

function authError(): string | null {
  const code = new URLSearchParams(location.search).get('auth_error')
  if (!code) return null
  return (
    t.account.errors[code as keyof typeof t.account.errors] ?? t.account.errors['provider-error']
  )
}

export function AccountPage() {
  const { account } = useAccount()
  useGamepadNavigation(true, () => navigate('/'))

  return (
    <main className="screen">
      <TopBar />
      {account === undefined ? (
        <p className="panel" role="status">
          {t.account.loading}
        </p>
      ) : account === null ? (
        <SignIn />
      ) : !account.ageConfirmed ? (
        <AgeGate />
      ) : (
        <Profile account={account} />
      )}
    </main>
  )
}

function SignIn() {
  const { providers } = useAccount()
  const error = authError()
  return (
    <section className="panel" aria-labelledby="account-title">
      <h1 id="account-title" className="title">
        {t.account.signInTitle}
      </h1>
      <p className="panel__lead">{t.account.signInLead}</p>
      {error && (
        <p className="field__help" data-error>
          {error}
        </p>
      )}
      {providers.length === 0 ? (
        <p className="panel__lead">{t.account.noProviders}</p>
      ) : (
        <div className="stack">
          {providers.map((provider) => (
            <a
              key={provider}
              className="button provider"
              data-provider={provider}
              href={signInUrl(provider)}
            >
              {t.account.continueWith(PROVIDER_NAMES[provider])}
            </a>
          ))}
        </div>
      )}
      <p className="field__help">{t.account.legal}</p>
    </section>
  )
}

function AgeGate() {
  const { refresh } = useAccount()
  const [busy, setBusy] = useState(false)

  async function answer(atLeast13: boolean) {
    setBusy(true)
    await accountRequest('/api/me/age', 'POST', { atLeast13 })
    await refresh()
    setBusy(false)
  }

  return (
    <section className="panel" aria-labelledby="age-title">
      <h1 id="age-title" className="title">
        {t.account.ageTitle}
      </h1>
      <p className="panel__lead">{t.account.ageLead}</p>
      <div className="stack">
        <button type="button" className="button" disabled={busy} onClick={() => answer(true)}>
          {t.account.ageYes}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={busy}
          onClick={() => answer(false)}
        >
          {t.account.ageNo}
        </button>
      </div>
    </section>
  )
}

function Profile({ account }: { account: Account }) {
  const { providers, refresh, signOut } = useAccount()
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const linked = new Set(account.identities.map((identity) => identity.provider))

  async function unlink(provider: ProviderId) {
    const response = await accountRequest(`/api/me/identities/${provider}`, 'DELETE')
    setError(response.ok ? null : t.account.unlinkRefused)
    await refresh()
  }

  async function deleteAccount() {
    await accountRequest('/api/me', 'DELETE')
    await refresh()
    navigate('/')
  }

  return (
    <section className="panel" aria-labelledby="profile-title">
      <div className="profile">
        {account.avatarUrl && <img src={account.avatarUrl} alt="" width={64} height={64} />}
        <h1 id="profile-title" className="title">
          {account.displayName}
        </h1>
      </div>

      <section className="stack" aria-labelledby="linked-title">
        <h2 id="linked-title" className="section-title">
          {t.account.linkedTitle}
        </h2>
        <ul className="rows">
          {(Object.keys(PROVIDER_NAMES) as ProviderId[])
            .filter((provider) => linked.has(provider) || providers.includes(provider))
            .map((provider) => {
              const identity = account.identities.find((item) => item.provider === provider)
              return (
                <li key={provider} className="rows__item">
                  <span>
                    {PROVIDER_NAMES[provider]}
                    {identity && <span className="rows__detail">{identity.username}</span>}
                  </span>
                  {identity ? (
                    <button type="button" className="link-button" onClick={() => unlink(provider)}>
                      {t.account.unlink}
                    </button>
                  ) : (
                    <a className="link-button" href={signInUrl(provider, { link: true })}>
                      {t.account.link}
                    </a>
                  )}
                </li>
              )
            })}
        </ul>
        {error && (
          <p className="field__help" data-error>
            {error}
          </p>
        )}
      </section>

      <section className="stack" aria-labelledby="data-title">
        <h2 id="data-title" className="section-title">
          {t.account.dataTitle}
        </h2>
        <div className="actions">
          <a className="button button--secondary" href="/api/me/export" download>
            {t.account.export}
          </a>
          <button type="button" className="button button--secondary" onClick={signOut}>
            {t.account.signOut}
          </button>
        </div>
      </section>

      <section className="stack" aria-labelledby="delete-title">
        <h2 id="delete-title" className="section-title">
          {t.account.deleteTitle}
        </h2>
        <p className="field__help">{t.account.deleteLead}</p>
        <label className="field">
          <span className="field__label">{t.account.deleteConfirmLabel}</span>
          <input
            className="input"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="button button--danger"
          disabled={confirmation.trim().toUpperCase() !== t.account.deleteWord}
          onClick={deleteAccount}
        >
          {t.account.deleteButton}
        </button>
      </section>
    </section>
  )
}
