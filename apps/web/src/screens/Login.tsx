import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Link } from '../components/Link'
import { t } from '../i18n'
import { accountRequest, type ProviderId, useAccount } from '../lib/account'
import { useServerConfig } from '../lib/config'
import { isDesktop, system } from '../lib/desktop'
import {
  askPasswordReset,
  confirmEmail,
  EMAIL_PATTERN,
  linkToken,
  MIN_PASSWORD,
  type PasswordResult,
  resetPassword,
  signInWithPassword,
  signUpWithPassword,
} from '../lib/password'
import { navigate } from '../lib/router'

export type LoginMode = 'signin' | 'signup' | 'forgot' | 'reset' | 'confirm'

const PATHS: Record<LoginMode, string> = {
  signin: '/login',
  signup: '/signup',
  forgot: '/forgot-password',
  reset: '/reset-password',
  confirm: '/confirm-email',
}

/** The page a login path shows, or null for any other path. */
export function loginModeOf(path: string): LoginMode | null {
  const found = Object.entries(PATHS).find(([, to]) => to === path)
  return found ? (found[0] as LoginMode) : null
}

/** Where to go once signed in: the page that sent the person here, else home. */
function returnPath(): string {
  const back = new URLSearchParams(location.search).get('return')
  return back?.startsWith('/') && !back.startsWith('//') ? back : '/'
}

function errorText(outcome: PasswordResult): string | null {
  if (outcome.ok) return null
  const errors = t.password.errors
  return errors[outcome.reason as keyof typeof errors] ?? errors.failed
}

/**
 * The way in: a panel on the left to sign in, create an account or get it back, and the
 * idea of Couchwarp on the right. In the desktop app it stands before everything else.
 * A new account confirms the age here once, never at later sign-ins.
 */
export function Login({ mode: initial }: { mode: LoginMode }) {
  const { account, refresh } = useAccount()
  const [mode, setMode] = useState(initial)
  useEffect(() => setMode(initial), [initial])
  const go = (next: LoginMode) => {
    // In the app the gate shows this page at any address: the mode lives here then.
    if (!isDesktop || loginModeOf(location.pathname)) {
      navigate(`${PATHS[next]}${location.search}`)
    }
    setMode(next)
  }
  const done = async () => {
    await refresh()
    if (loginModeOf(location.pathname)) navigate(returnPath())
  }

  // Signed in already (back from Discord or Google): the age once, then on.
  const needsAge = account && !account.ageConfirmed
  useEffect(() => {
    if (account?.ageConfirmed && (mode === 'signin' || mode === 'signup')) {
      if (loginModeOf(location.pathname)) navigate(returnPath())
    }
  }, [account, mode])

  let panel: ReactNode
  if (needsAge && mode !== 'confirm' && mode !== 'reset') panel = <AgeStep />
  else if (mode === 'signup') panel = <SignUp onDone={done} onSignIn={() => go('signin')} />
  else if (mode === 'forgot') panel = <Forgot onBack={() => go('signin')} />
  else if (mode === 'reset') panel = <Reset onDone={done} />
  else if (mode === 'confirm') panel = <Confirm />
  else panel = <SignIn onDone={done} onSignUp={() => go('signup')} onForgot={() => go('forgot')} />

  return (
    <div className="login" data-system={isDesktop ? system : undefined}>
      <section className="login__panel">
        <div className="login__brand" data-tauri-drag-region>
          <span className="wordmark">
            <span className="wordmark__lights" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            Couchwarp
          </span>
        </div>
        <main className="login__body">{panel}</main>
        <footer className="login__foot">
          {!isDesktop && (
            <Link to="/" className="link-button">
              {t.login.guest}
            </Link>
          )}
          <p className="login__legal">
            {t.login.legal[0]}
            <Link to="/terms">{t.login.terms}</Link>
            {t.login.legal[1]}
            <Link to="/privacy">{t.login.privacy}</Link>
            {t.login.legal[2]}
          </p>
        </footer>
      </section>
      <Artwork />
    </div>
  )
}

function Heading({ title, lead }: { title: string; lead?: string }) {
  return (
    <header className="login__head">
      <h1 className="login__title">{title}</h1>
      {lead && <p className="login__lead">{lead}</p>}
    </header>
  )
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p className="login__problem" role="alert">
      {text}
    </p>
  ) : null
}

/** Back from Discord or Google with an error in the address. */
function providerError(): string | null {
  const code = new URLSearchParams(location.search).get('auth_error')
  if (!code) return null
  return (
    t.account.errors[code as keyof typeof t.account.errors] ?? t.account.errors['provider-error']
  )
}

function SignIn({
  onDone,
  onSignUp,
  onForgot,
}: {
  onDone(): Promise<void>
  onSignUp(): void
  onForgot(): void
}) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState(providerError)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setProblem(null)
    if (!login.trim() || !password) return setProblem(t.password.errors['wrong-login'])
    setBusy(true)
    const outcome = await signInWithPassword(login.trim(), password)
    setBusy(false)
    if (outcome.ok) await onDone()
    else setProblem(errorText(outcome))
  }

  return (
    <div className="login__stack">
      <Heading
        title={t.login.welcome}
        lead={isDesktop ? t.login.appNeedsAccount : t.login.welcomeLead}
      />
      <Providers onProblem={setProblem} onDone={onDone} />
      <form className="login__form" onSubmit={submit} noValidate>
        <Field id="login-email" label={t.password.login}>
          <input
            id="login-email"
            className="input"
            type="email"
            value={login}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => setLogin(event.target.value)}
          />
        </Field>
        <Field
          id="login-password"
          label={t.password.password}
          aside={
            <button type="button" className="link-button" onClick={onForgot}>
              {t.password.forgot}
            </button>
          }
        >
          <PasswordInput
            id="login-password"
            value={password}
            autoComplete="current-password"
            onChange={setPassword}
          />
        </Field>
        <Problem text={problem} />
        <button type="submit" className="button button--large" disabled={busy}>
          {t.password.signIn}
        </button>
      </form>
      <p className="login__switch">
        {t.password.noAccount}{' '}
        <button type="button" className="link-button" onClick={onSignUp}>
          {t.password.createOne}
        </button>
      </p>
    </div>
  )
}

function SignUp({ onDone, onSignIn }: { onDone(): Promise<void>; onSignIn(): void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [atLeast13, setAtLeast13] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setProblem(null)
    const errors = t.password.errors
    if (!EMAIL_PATTERN.test(email.trim())) return setProblem(errors['invalid-email'])
    if (password.length < MIN_PASSWORD) return setProblem(errors['invalid-password'])
    if (name.trim().length < 2) return setProblem(errors['invalid-name'])
    if (!atLeast13) return setProblem(errors['too-young'])
    setBusy(true)
    const outcome = await signUpWithPassword({
      email: email.trim(),
      password,
      displayName: name.trim(),
      atLeast13,
    })
    setBusy(false)
    if (outcome.ok) await onDone()
    else setProblem(errorText(outcome))
  }

  return (
    <div className="login__stack">
      <Heading title={t.login.createTitle} lead={t.login.createLead} />
      <Providers onProblem={setProblem} onDone={onDone} />
      <form className="login__form" onSubmit={submit} noValidate>
        <Field id="signup-email" label={t.password.email} help={t.password.emailHelp}>
          <input
            id="signup-email"
            className="input"
            type="email"
            value={email}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field id="signup-password" label={t.password.password} help={t.password.passwordHelp}>
          <PasswordInput
            id="signup-password"
            value={password}
            autoComplete="new-password"
            onChange={setPassword}
          />
        </Field>
        <Field id="signup-name" label={t.login.nameLabel} help={t.login.nameHelp}>
          <input
            id="signup-name"
            className="input"
            value={name}
            maxLength={32}
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={atLeast13}
            onChange={(event) => setAtLeast13(event.target.checked)}
          />
          <span>{t.account.ageYes}</span>
        </label>
        <Problem text={problem} />
        <button type="submit" className="button button--large" disabled={busy}>
          {t.password.create}
        </button>
      </form>
      <p className="login__switch">
        {t.password.haveAccount}{' '}
        <button type="button" className="link-button" onClick={onSignIn}>
          {t.password.signInInstead}
        </button>
      </p>
    </div>
  )
}

function Forgot({ onBack }: { onBack(): void }) {
  const config = useServerConfig()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setProblem(null)
    if (!EMAIL_PATTERN.test(email.trim())) return setProblem(t.password.errors['invalid-email'])
    setBusy(true)
    const outcome = await askPasswordReset(email.trim())
    setBusy(false)
    if (outcome.ok) setSentTo(email.trim())
    else setProblem(errorText(outcome))
  }

  return (
    <div className="login__stack">
      <Heading title={t.password.forgotTitle} lead={t.password.forgotLead} />
      {config && !config.email ? (
        <p className="notice" data-tone="warning">
          {t.password.forgotUnavailable}
        </p>
      ) : sentTo ? (
        <p className="notice" data-tone="success" role="status">
          {t.password.forgotSent(sentTo)}
        </p>
      ) : (
        <form className="login__form" onSubmit={submit} noValidate>
          <Field id="forgot-email" label={t.password.email}>
            <input
              id="forgot-email"
              className="input"
              type="email"
              value={email}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Problem text={problem} />
          <button type="submit" className="button button--large" disabled={busy}>
            {t.password.forgotSend}
          </button>
        </form>
      )}
      <p className="login__switch">
        <button type="button" className="link-button" onClick={onBack}>
          {t.password.back}
        </button>
      </p>
    </div>
  )
}

function Reset({ onDone }: { onDone(): Promise<void> }) {
  const [token] = useState(linkToken)
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(
    token ? null : t.password.errors['link-expired'],
  )
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setProblem(null)
    if (!token) return setProblem(t.password.errors['link-expired'])
    if (password.length < MIN_PASSWORD) return setProblem(t.password.errors['invalid-password'])
    setBusy(true)
    const outcome = await resetPassword(token, password)
    setBusy(false)
    if (!outcome.ok) return setProblem(errorText(outcome))
    // The token is spent: it leaves the address bar and the history.
    history.replaceState(null, '', location.pathname)
    await onDone()
  }

  return (
    <div className="login__stack">
      <Heading title={t.password.resetTitle} lead={t.password.resetLead} />
      <form className="login__form" onSubmit={submit} noValidate>
        <Field id="reset-password" label={t.password.next} help={t.password.passwordHelp}>
          <PasswordInput
            id="reset-password"
            value={password}
            autoComplete="new-password"
            onChange={setPassword}
          />
        </Field>
        <Problem text={problem} />
        <button type="submit" className="button button--large" disabled={busy || !token}>
          {t.password.resetSave}
        </button>
      </form>
    </div>
  )
}

function Confirm() {
  const { refresh } = useAccount()
  const [state, setState] = useState<
    { kind: 'busy' } | { kind: 'done' } | { kind: 'failed'; text: string }
  >({ kind: 'busy' })
  useEffect(() => {
    const token = linkToken()
    if (!token) {
      setState({ kind: 'failed', text: t.password.errors['link-expired'] })
      return
    }
    // The token works once: the address bar forgets it right away.
    history.replaceState(null, '', location.pathname)
    confirmEmail(token).then((outcome) => {
      if (outcome.ok) {
        setState({ kind: 'done' })
        refresh().catch(console.error)
      } else {
        setState({ kind: 'failed', text: errorText(outcome) ?? t.password.errors.failed })
      }
    })
  }, [refresh])

  return (
    <div className="login__stack">
      <Heading title={t.password.confirmTitle} />
      {state.kind === 'busy' && (
        <p className="muted" role="status">
          {t.password.confirming}
        </p>
      )}
      {state.kind === 'done' && (
        <p className="notice" data-tone="success" role="status">
          {t.password.emailVerified}
        </p>
      )}
      {state.kind === 'failed' && <Problem text={state.text} />}
      <button type="button" className="button button--large" onClick={() => navigate('/')}>
        {t.password.continue}
      </button>
    </div>
  )
}

/** Asked once, right after an account is made with Discord or Google. */
function AgeStep() {
  const { refresh } = useAccount()
  const [busy, setBusy] = useState(false)

  async function answer(atLeast13: boolean) {
    setBusy(true)
    await accountRequest('/api/me/age', 'POST', { atLeast13 })
    await refresh()
    setBusy(false)
  }

  return (
    <div className="login__stack">
      <Heading title={t.login.ageTitle} lead={t.login.ageLead} />
      <div className="login__form">
        <button
          type="button"
          className="button button--large"
          disabled={busy}
          onClick={() => answer(true)}
        >
          {t.account.ageYes}
        </button>
        <button
          type="button"
          className="button button--large button--secondary"
          disabled={busy}
          onClick={() => answer(false)}
        >
          {t.account.ageNo}
        </button>
      </div>
    </div>
  )
}

const PROVIDER_NAMES: Record<ProviderId, string> = { discord: 'Discord', google: 'Google' }

/** Discord and Google, each in its own colours, as their guidelines ask. */
function Providers({
  onProblem,
  onDone,
}: {
  onProblem(text: string | null): void
  onDone(): Promise<void>
}) {
  const { providers, signIn } = useAccount()
  const [waiting, setWaiting] = useState(false)
  if (providers.length === 0) return null

  async function choose(provider: ProviderId) {
    onProblem(null)
    setWaiting(isDesktop)
    try {
      await signIn(provider)
      if (isDesktop) await onDone()
    } catch (reason) {
      console.error(reason)
      onProblem(t.account.errors['provider-error'])
    } finally {
      setWaiting(false)
    }
  }

  return (
    <>
      <div className="login__providers">
        {providers.map((provider) => (
          <button
            key={provider}
            type="button"
            className="provider-button"
            data-provider={provider}
            disabled={waiting}
            onClick={() => choose(provider)}
          >
            {provider === 'discord' ? <DiscordMark /> : <GoogleMark />}
            {t.account.continueWith(PROVIDER_NAMES[provider])}
          </button>
        ))}
        {waiting && (
          <p className="field__help" role="status">
            {t.account.inBrowser}
          </p>
        )}
      </div>
      <p className="divider">{t.password.or}</p>
    </>
  )
}

function Field({
  id,
  label,
  help,
  aside,
  children,
}: {
  id: string
  label: string
  help?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="field">
      <span className="field__row">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        {aside}
      </span>
      {children}
      {help && <p className="field__help">{help}</p>}
    </div>
  )
}

export function PasswordInput({
  id,
  value,
  autoComplete,
  onChange,
}: {
  id: string
  value: string
  autoComplete: string
  onChange(value: string): void
}) {
  const [shown, setShown] = useState(false)
  return (
    <span className="password-input">
      <input
        id={id}
        className="input"
        type={shown ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="password-input__toggle"
        aria-pressed={shown}
        aria-controls={id}
        onClick={() => setShown(!shown)}
      >
        {shown ? t.password.hide : t.password.show}
      </button>
    </span>
  )
}

function DiscordMark() {
  return (
    <svg className="provider-button__mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.61 1.25a18.3 18.3 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13 13 0 0 1-1.87-.89.08.08 0 0 1 0-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08 0l.37.3a.08.08 0 0 1 0 .13c-.6.35-1.22.64-1.87.89a.08.08 0 0 0-.04.1c.36.7.78 1.36 1.23 2a.08.08 0 0 0 .08.02 19.8 19.8 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z"
      />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg className="provider-button__mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z"
      />
    </svg>
  )
}

/**
 * The right side: the four player lights of a console, each one a friend at home,
 * joined on the host's screen. Drawn here so it follows the palette.
 */
function Artwork() {
  const friends = [
    { x: 92, y: 96, light: 1 },
    { x: 468, y: 84, light: 2 },
    { x: 70, y: 400, light: 3 },
    { x: 486, y: 412, light: 4 },
  ]
  return (
    <aside className="login__art" aria-hidden="true">
      <svg className="login__scene" viewBox="0 0 560 500" role="presentation">
        {friends.map((friend) => (
          <path
            key={`line-${friend.light}`}
            className="login__wire"
            data-light={friend.light}
            d={`M ${friend.x} ${friend.y} Q ${(friend.x + 280) / 2} 250 280 250`}
          />
        ))}
        <rect className="login__screen" x="170" y="178" width="220" height="140" rx="16" />
        <rect className="login__stand" x="262" y="318" width="36" height="22" rx="4" />
        <rect className="login__pill" x="206" y="226" width="148" height="44" rx="22" />
        {[1, 2, 3, 4].map((light, index) => (
          <circle
            key={light}
            className="login__light"
            data-light={light}
            cx={230 + index * 33.3}
            cy="248"
            r="11"
          />
        ))}
        {friends.map((friend) => (
          <g key={friend.light} transform={`translate(${friend.x - 30} ${friend.y - 20})`}>
            <rect className="login__device" width="60" height="40" rx="12" />
            <circle className="login__light" data-light={friend.light} cx="30" cy="20" r="7" />
          </g>
        ))}
      </svg>
      <div className="login__art-text">
        <p className="login__art-title">{t.login.artTitle}</p>
        <p className="login__art-lead">{t.login.artLead}</p>
      </div>
    </aside>
  )
}
