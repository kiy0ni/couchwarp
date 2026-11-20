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
  changeEmail,
  changePassword,
  EMAIL_PATTERN,
  MIN_PASSWORD,
  type PasswordResult,
  resendConfirmation,
} from '../../lib/password'
import { PROFILE_COLORS, removeAvatar, updateProfile, uploadAvatar } from '../../lib/profile'
import { navigate } from '../../lib/router'
import { PasswordInput } from '../Login'

const PROVIDER_NAMES: Record<ProviderId, string> = { discord: 'Discord', google: 'Google' }

/** The profile, sign-in and security, history and data. */
export function AccountTab() {
  const { account } = useAccount()
  // Signed out, the sign-in screen stands in front of every page.
  if (!account) {
    return (
      <p className="muted" role="status">
        {t.account.loading}
      </p>
    )
  }
  return <Profile account={account} />
}

function errorText(outcome: PasswordResult): string | null {
  if (outcome.ok) return null
  const errors = t.password.errors
  return errors[outcome.reason as keyof typeof errors] ?? errors.failed
}

/** The address and the password: what gets the account back, and what changes them. */
function Security({ account, onChanged }: { account: Account; onChanged(): Promise<void> }) {
  return (
    <Section title={t.account.securityTitle}>
      <div className="settings__rows">
        <EmailRow account={account} onChanged={onChanged} />
        <PasswordRow account={account} onChanged={onChanged} />
      </div>
    </Section>
  )
}

function EmailRow({ account, onChanged }: { account: Account; onChanged(): Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)
  const needsPassword = account.hasPassword

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!EMAIL_PATTERN.test(email.trim())) {
      return setStatus({ text: t.password.errors['invalid-email'], error: true })
    }
    const outcome = await changeEmail(email.trim(), password)
    if (!outcome.ok) return setStatus({ text: errorText(outcome) ?? '', error: true })
    setStatus({ text: t.password.emailSent(email.trim()), error: false })
    setEditing(false)
    setPassword('')
    await onChanged()
  }

  async function resend() {
    const outcome = await resendConfirmation()
    setStatus(
      outcome.ok
        ? { text: t.password.resent, error: false }
        : { text: errorText(outcome) ?? '', error: true },
    )
  }

  return (
    <div className="setting setting--stacked">
      <div className="setting__text">
        <span className="setting__title">{t.password.emailTitle}</span>
        <p className="setting__help">
          {account.email ? (
            <>
              <span className="setting__value">{account.email}</span>{' '}
              <span className="tag" data-tone={account.emailVerified ? 'success' : 'warning'}>
                {account.emailVerified ? t.password.emailVerified : t.password.emailUnverified}
              </span>
            </>
          ) : (
            t.password.emailNone
          )}
        </p>
      </div>
      <div className="setting__control actions">
        {account.email && !account.emailVerified && (
          <button type="button" className="link-button" onClick={resend}>
            {t.password.resend}
          </button>
        )}
        {!editing && (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => {
              setEditing(true)
              setStatus(null)
            }}
          >
            {account.email ? t.password.changeEmail : t.password.addEmail}
          </button>
        )}
      </div>
      {editing && (
        <form className="setting__form" onSubmit={submit} noValidate>
          <label className="field">
            <span className="field__label">{t.password.newEmail}</span>
            <input
              className="input"
              type="email"
              value={email}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {needsPassword && (
            <div className="field">
              <label className="field__label" htmlFor="email-password">
                {t.password.current}
              </label>
              <PasswordInput
                id="email-password"
                value={password}
                autoComplete="current-password"
                onChange={setPassword}
              />
              <p className="field__help">{t.password.needsCurrent}</p>
            </div>
          )}
          <div className="actions">
            <button type="submit" className="button button--small">
              {t.password.save}
            </button>
            <button type="button" className="link-button" onClick={() => setEditing(false)}>
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}
      {status && (
        <p
          className="field__help setting__status"
          data-error={status.error || undefined}
          role="status"
        >
          {status.text}
        </p>
      )}
    </div>
  )
}

function PasswordRow({ account, onChanged }: { account: Account; onChanged(): Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (next.length < MIN_PASSWORD) {
      return setStatus({ text: t.password.errors['invalid-password'], error: true })
    }
    if (!account.hasPassword && !account.email && !EMAIL_PATTERN.test(email.trim())) {
      return setStatus({ text: t.password.errors['invalid-email'], error: true })
    }
    const outcome = account.hasPassword
      ? await changePassword(current, next)
      : await addPassword(email.trim(), next)
    if (!outcome.ok) return setStatus({ text: errorText(outcome) ?? '', error: true })
    setStatus({ text: account.hasPassword ? t.password.changed : t.profile.saved, error: false })
    setEditing(false)
    setCurrent('')
    setNext('')
    await onChanged()
  }

  return (
    <div className="setting setting--stacked">
      <div className="setting__text">
        <span className="setting__title">{t.password.title}</span>
        <p className="setting__help">
          {account.hasPassword ? t.password.passwordHelp : t.password.addLead}
        </p>
      </div>
      <div className="setting__control">
        {!editing && (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => {
              setEditing(true)
              setStatus(null)
            }}
          >
            {account.hasPassword ? t.password.changeTitle : t.password.add}
          </button>
        )}
      </div>
      {editing && (
        <form className="setting__form" onSubmit={submit} noValidate>
          {!account.hasPassword && !account.email && (
            <label className="field">
              <span className="field__label">{t.password.email}</span>
              <input
                className="input"
                type="email"
                value={email}
                autoComplete="email"
                autoCapitalize="none"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          {account.hasPassword && (
            <div className="field">
              <label className="field__label" htmlFor="password-current">
                {t.password.current}
              </label>
              <PasswordInput
                id="password-current"
                value={current}
                autoComplete="current-password"
                onChange={setCurrent}
              />
            </div>
          )}
          <div className="field">
            <label className="field__label" htmlFor="password-next">
              {t.password.next}
            </label>
            <PasswordInput
              id="password-next"
              value={next}
              autoComplete="new-password"
              onChange={setNext}
            />
          </div>
          <div className="actions">
            <button type="submit" className="button button--small">
              {t.password.save}
            </button>
            <button type="button" className="link-button" onClick={() => setEditing(false)}>
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}
      {status && (
        <p
          className="field__help setting__status"
          data-error={status.error || undefined}
          role="status"
        >
          {status.text}
        </p>
      )}
    </div>
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

      <Security account={account} onChanged={refresh} />

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
            <Link to={`/profile/${account.id}`} className="link-button">
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
