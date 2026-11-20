import { type FormEvent, useRef, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { Badges } from '../../components/Badges'
import { Link } from '../../components/Link'
import { Section } from '../../components/Page'
import { SettingRow } from '../../components/SettingRow'
import { t } from '../../i18n'
import {
  type Account,
  accountRequest,
  type ProviderId,
  signInUrl,
  useAccount,
} from '../../lib/account'
import { isDesktop } from '../../lib/desktop'
import { fullTag } from '../../lib/friends'
import { playedOn, useHistory } from '../../lib/history'
import {
  addPassword,
  LOGIN_PATTERN,
  MIN_PASSWORD,
  signInWithPassword,
  signUpWithPassword,
} from '../../lib/password'
import { PROFILE_COLORS, removeAvatar, updateProfile, uploadAvatar } from '../../lib/profile'
import { navigate } from '../../lib/router'

const PROVIDER_NAMES: Record<ProviderId, string> = { discord: 'Discord', google: 'Google' }

/** Sign in, confirm the age, or the profile, linked accounts, history and data. */
export function AccountTab() {
  const { account } = useAccount()
  if (account === undefined) {
    return (
      <p className="muted" role="status">
        {t.account.loading}
      </p>
    )
  }
  if (account === null) return <SignIn />
  if (!account.ageConfirmed) return <AgeGate />
  return <Profile account={account} />
}

function authError(): string | null {
  const code = new URLSearchParams(location.search).get('auth_error')
  if (!code) return null
  return (
    t.account.errors[code as keyof typeof t.account.errors] ?? t.account.errors['provider-error']
  )
}

function SignIn() {
  const { providers, signIn } = useAccount()
  const [error, setError] = useState(authError)
  const [waiting, setWaiting] = useState(false)

  async function choose(provider: ProviderId) {
    setError(null)
    setWaiting(isDesktop)
    try {
      await signIn(provider)
    } catch (reason) {
      console.error(reason)
      setError(t.account.errors['provider-error'])
    } finally {
      setWaiting(false)
    }
  }

  return (
    <section className="card card--feature stack">
      <h2 className="card__title">{t.account.signInTitle}</h2>
      <p className="card__text">{t.account.signInLead}</p>
      {error && (
        <p className="field__help" data-error>
          {error}
        </p>
      )}
      {waiting && (
        <p className="field__help" role="status">
          {t.account.inBrowser}
        </p>
      )}
      {providers.length > 0 && (
        <div className="stack">
          {providers.map((provider) => (
            <button
              key={provider}
              type="button"
              className="button provider"
              data-provider={provider}
              disabled={waiting}
              onClick={() => choose(provider)}
            >
              {t.account.continueWith(PROVIDER_NAMES[provider])}
            </button>
          ))}
        </div>
      )}
      {providers.length > 0 && <p className="divider">{t.password.or}</p>}
      <PasswordForm />
      <p className="field__help">{t.account.legal}</p>
    </section>
  )
}

/** Sign in or sign up with a login and a password, for people without Discord or Google. */
function PasswordForm() {
  const { refresh } = useAccount()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [atLeast13, setAtLeast13] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const signingUp = mode === 'signup'

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!LOGIN_PATTERN.test(login.trim())) return setError(t.password.errors['invalid-login'])
    if (password.length < MIN_PASSWORD) return setError(t.password.errors['invalid-password'])
    if (signingUp && !atLeast13) return setError(t.password.errors['too-young'])
    setBusy(true)
    const outcome = signingUp
      ? await signUpWithPassword({ login: login.trim(), password, displayName: name, atLeast13 })
      : await signInWithPassword(login.trim(), password)
    setBusy(false)
    if (!outcome.ok) {
      const errors = t.password.errors
      setError(errors[outcome.reason as keyof typeof errors] ?? errors.failed)
      return
    }
    await refresh()
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor="password-login">
          {t.password.login}
        </label>
        <input
          id="password-login"
          className="input"
          value={login}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => setLogin(event.target.value)}
        />
        {signingUp && <p className="field__help">{t.password.loginHelp}</p>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor="password-secret">
          {t.password.password}
        </label>
        <input
          id="password-secret"
          className="input"
          type="password"
          value={password}
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          onChange={(event) => setPassword(event.target.value)}
        />
        {signingUp && <p className="field__help">{t.password.passwordHelp}</p>}
      </div>
      {signingUp && (
        <div className="field">
          <label className="field__label" htmlFor="password-name">
            {t.profile.name}
          </label>
          <input
            id="password-name"
            className="input"
            value={name}
            maxLength={32}
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      )}
      {signingUp && (
        <label className="check">
          <input
            type="checkbox"
            checked={atLeast13}
            onChange={(event) => setAtLeast13(event.target.checked)}
          />
          <span>{t.account.ageYes}</span>
        </label>
      )}
      {error && (
        <p className="field__help" data-error role="status">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={busy}>
        {signingUp ? t.password.create : t.password.signIn}
      </button>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          setMode(signingUp ? 'signin' : 'signup')
          setError(null)
        }}
      >
        {signingUp ? t.password.haveAccount : t.password.noAccount}
      </button>
      {signingUp && <p className="field__help">{t.password.noReset}</p>}
    </form>
  )
}

/** Adds a login and password to an account that has only Discord or Google. */
function AddPassword({ onAdded }: { onAdded(): void }) {
  const [open, setOpen] = useState(false)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        {t.password.add}
      </button>
    )
  }
  return (
    <form
      className="add-password"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!LOGIN_PATTERN.test(login.trim())) return setError(t.password.errors['invalid-login'])
        if (password.length < MIN_PASSWORD) return setError(t.password.errors['invalid-password'])
        const outcome = await addPassword(login.trim(), password)
        if (outcome.ok) {
          setOpen(false)
          onAdded()
        } else {
          const errors = t.password.errors
          setError(errors[outcome.reason as keyof typeof errors] ?? errors.failed)
        }
      }}
    >
      <input
        className="input"
        aria-label={t.password.login}
        placeholder={t.password.login}
        value={login}
        autoComplete="username"
        autoCapitalize="none"
        onChange={(event) => setLogin(event.target.value)}
      />
      <input
        className="input"
        type="password"
        aria-label={t.password.password}
        placeholder={t.password.password}
        value={password}
        autoComplete="new-password"
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" className="button button--small">
        {t.console.save}
      </button>
      {error && (
        <p className="field__help" data-error role="status">
          {error}
        </p>
      )}
    </form>
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
    <section className="card card--feature stack">
      <h2 className="card__title">{t.account.ageTitle}</h2>
      <p className="card__text">{t.account.ageLead}</p>
      <div className="actions">
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

  async function unlink(provider: ProviderId | 'password') {
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
    <div className="stack stack--loose">
      <ProfileEditor account={account} onSignOut={signOut} />

      <Section title={t.account.linkedTitle}>
        <ul className="list">
          {(Object.keys(PROVIDER_NAMES) as ProviderId[])
            .filter((provider) => linked.has(provider) || providers.includes(provider))
            .map((provider) => {
              const identity = account.identities.find((item) => item.provider === provider)
              return (
                <li key={provider} className="list__item">
                  <span className="list__main">
                    <span className="list__title">{PROVIDER_NAMES[provider]}</span>
                    <span className="list__detail">
                      {identity?.username ?? t.account.notLinked}
                    </span>
                  </span>
                  {identity ? (
                    <button type="button" className="link-button" onClick={() => unlink(provider)}>
                      {t.account.unlink}
                    </button>
                  ) : isDesktop ? (
                    <span className="list__detail">{t.account.linkOnSite}</span>
                  ) : (
                    <a className="link-button" href={signInUrl(provider, { link: true })}>
                      {t.account.link}
                    </a>
                  )}
                </li>
              )
            })}
          <li className="list__item">
            <span className="list__main">
              <span className="list__title">{t.password.title}</span>
              <span className="list__detail">
                {account.identities.find((item) => item.provider === 'password')?.username ??
                  t.account.notLinked}
              </span>
            </span>
            {linked.has('password') ? (
              <button type="button" className="link-button" onClick={() => unlink('password')}>
                {t.account.unlink}
              </button>
            ) : (
              <AddPassword onAdded={refresh} />
            )}
          </li>
        </ul>
        {error && (
          <p className="field__help" data-error>
            {error}
          </p>
        )}
      </Section>

      <History account={account} />

      <Section title={t.account.dataTitle}>
        <div className="card stack">
          <p className="card__text">{t.account.dataLead}</p>
          <div className="actions">
            <a className="button button--secondary" href="/api/me/export" download>
              {t.account.export}
            </a>
          </div>
        </div>
      </Section>

      <Section title={t.account.deleteTitle}>
        <div className="card card--danger stack">
          <p className="card__text">{t.account.deleteLead}</p>
          <label className="field">
            <span className="field__label">{t.account.deleteConfirmLabel}</span>
            <input
              className="input"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="button button--danger"
              disabled={confirmation.trim().toUpperCase() !== t.account.deleteWord}
              onClick={deleteAccount}
            >
              {t.account.deleteButton}
            </button>
          </div>
        </div>
      </Section>
    </div>
  )
}

function History({ account }: { account: Account }) {
  const games = useHistory(account)
  return (
    <Section title={t.account.historyTitle}>
      {games === null ? null : games.length === 0 ? (
        <p className="muted">{t.account.historyEmpty}</p>
      ) : (
        <ul className="list">
          {games
            .filter(
              (game, index) =>
                games.findIndex((other) => other.roomCode === game.roomCode) === index,
            )
            .slice(0, 20)
            .map((game) => (
              <li key={`${game.roomCode}-${game.joinedAt}`} className="list__item">
                <span className="list__main">
                  <span className="list__title">{game.title || game.game || game.roomCode}</span>
                  {game.hostName && (
                    <span className="list__detail">{t.browse.hostedBy(game.hostName)}</span>
                  )}
                </span>
                <time className="list__detail" dateTime={new Date(game.joinedAt).toISOString()}>
                  {playedOn.format(game.joinedAt)}
                </time>
              </li>
            ))}
        </ul>
      )}
    </Section>
  )
}

/** Standard mapping names, in the browser's button order. */

/** The profile others see: picture, name, colour, badges. Each change saves at once. */
function ProfileEditor({ account, onSignOut }: { account: Account; onSignOut(): void }) {
  const { refresh } = useAccount()
  const [name, setName] = useState(account.displayName)
  const [status, setStatus] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  async function run(change: Promise<boolean>, failure: string) {
    setStatus(null)
    const ok = await change.catch(() => false)
    setStatus(ok ? t.profile.saved : failure)
    await refresh()
  }

  return (
    <>
      <section className="card profile" data-color={account.color ?? undefined}>
        <Avatar
          name={account.displayName}
          url={account.avatarUrl}
          color={account.color}
          size={88}
        />
        <span className="profile__who">
          <span className="profile__name">{account.displayName}</span>
          {account.tag !== null && (
            <span className="profile__tag">{fullTag(account.displayName, account.tag)}</span>
          )}
          <Badges badges={account.badges} />
          <span className="profile__links">
            <Link to={`/profil/${account.id}`} className="link-button">
              {t.profilePage.mine}
            </Link>
            <Link to="/badges" className="link-button">
              {t.profilePage.allBadges}
            </Link>
          </span>
        </span>
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={onSignOut}
        >
          {t.account.signOut}
        </button>
      </section>

      <div className="settings__rows">
        <SettingRow id="profile-picture" title={t.profile.picture} help={t.profile.pictureHelp}>
          <span className="actions">
            <input
              ref={file}
              id="profile-picture"
              type="file"
              accept="image/png, image/jpeg, image/webp"
              className="visually-hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0]
                event.target.value = ''
                if (chosen) run(uploadAvatar(chosen), t.profile.pictureFailed)
              }}
            />
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => file.current?.click()}
            >
              {t.profile.choose}
            </button>
            {account.avatarUrl?.startsWith('/api/users/') && (
              <button
                type="button"
                className="link-button"
                onClick={() => run(removeAvatar(), t.profile.pictureFailed)}
              >
                {t.profile.remove}
              </button>
            )}
          </span>
        </SettingRow>
        <SettingRow id="profile-name" title={t.profile.name} help={t.profile.nameHelp}>
          <form
            className="profile__name-form"
            onSubmit={(event) => {
              event.preventDefault()
              run(updateProfile({ displayName: name }), t.profile.nameFailed)
            }}
          >
            <input
              id="profile-name"
              className="input"
              value={name}
              maxLength={32}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              type="submit"
              className="button button--small"
              disabled={name.trim() === account.displayName || name.trim().length < 2}
            >
              {t.console.save}
            </button>
          </form>
        </SettingRow>
        <div className="setting">
          <div className="setting__text">
            <span className="setting__title">{t.profile.color}</span>
            <p className="setting__help">{t.profile.colorHelp}</p>
          </div>
          <fieldset className="setting__control swatches">
            <legend className="visually-hidden">{t.profile.color}</legend>
            {PROFILE_COLORS.map((color) => (
              <label key={color} className="swatch" data-color={color}>
                <input
                  type="radio"
                  name="profile-color"
                  checked={account.color === color}
                  onChange={() => run(updateProfile({ color }), t.profile.nameFailed)}
                />
                <span className="visually-hidden">{t.profile.colors[color]}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </div>
      {status && (
        <p className="field__help" role="status">
          {status}
        </p>
      )}
    </>
  )
}
