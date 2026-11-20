import { getVersion } from '@tauri-apps/api/app'
import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { KeyboardHelp } from '../components/KeyboardHelp'
import { Link } from '../components/Link'
import { Page, Section } from '../components/Page'
import { PlayerBadge } from '../components/PlayerBadge'
import { Shell } from '../components/Shell'
import { chosenLanguage, type LanguageChoice, setLanguage, t } from '../i18n'
import {
  type Account,
  accountRequest,
  type ProviderId,
  signInUrl,
  useAccount,
} from '../lib/account'
import { isDesktop } from '../lib/desktop'
import { padName } from '../lib/gamepads'
import { playedOn, useHistory } from '../lib/history'
import { navigate } from '../lib/router'
import { useGamepads } from '../lib/use-gamepads'

/** How far the stick dot moves at full tilt, in its own widths: to the edge of the well. */
const STICK_TRAVEL = 83

const PROVIDER_NAMES: Record<ProviderId, string> = { discord: 'Discord', google: 'Google' }

type Tab = 'account' | 'controllers' | 'keyboard' | 'app'

const TABS: readonly { id: Tab; path: string; icon: IconName }[] = [
  { id: 'account', path: '/parametres', icon: 'user' },
  { id: 'controllers', path: '/parametres/manettes', icon: 'pad' },
  { id: 'keyboard', path: '/parametres/clavier', icon: 'keyboard' },
  { id: 'app', path: '/parametres/application', icon: 'app' },
]

/** The settings, one tab per subject; the path says which. */
export function Settings({ path }: { path: string }) {
  const tab = TABS.find((item) => item.path === path)?.id ?? 'account'
  return (
    <Shell onBack={() => navigate('/')}>
      <Page title={t.settings.title}>
        <div className="settings">
          <nav className="tabs" aria-label={t.settings.title}>
            {TABS.map((item) => (
              <Link
                key={item.id}
                to={item.path}
                className="tabs__item"
                aria-current={item.id === tab ? 'page' : undefined}
              >
                <Icon name={item.icon} size={18} />
                {t.settings.tabs[item.id]}
              </Link>
            ))}
          </nav>
          <div className="settings__body">
            {tab === 'account' && <AccountTab />}
            {tab === 'controllers' && <ControllersTab />}
            {tab === 'keyboard' && <KeyboardTab />}
            {tab === 'app' && <AppTab />}
          </div>
        </div>
      </Page>
    </Shell>
  )
}

function AccountTab() {
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
      {providers.length === 0 ? (
        <p className="card__text">{t.account.noProviders}</p>
      ) : (
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
    <div className="stack stack--loose">
      <section className="card profile">
        {account.avatarUrl ? (
          <img className="profile__picture" src={account.avatarUrl} alt="" width={64} height={64} />
        ) : (
          <span className="profile__picture" aria-hidden="true">
            {account.displayName.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="profile__who">
          <span className="profile__name">{account.displayName}</span>
          <span className="muted">{t.account.signedInWith(account.identities.length)}</span>
        </span>
        <button type="button" className="button button--secondary" onClick={signOut}>
          {t.account.signOut}
        </button>
      </section>

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
          {games.slice(0, 20).map((game) => (
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
const BUTTONS = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'Select',
  'Start',
  'L3',
  'R3',
  '↑',
  '↓',
  '←',
  '→',
  'Home',
] as const

function ControllersTab() {
  const gamepads = useGamepads()
  return (
    <div className="stack stack--loose">
      <p className="muted">{t.settings.controllersLead}</p>
      {gamepads.length === 0 ? (
        <section className="card card--feature">
          <h2 className="card__title">{t.settings.noController}</h2>
          <p className="card__text">{t.settings.noControllerHelp}</p>
        </section>
      ) : (
        gamepads.map((gamepad, index) => (
          <PadTester key={gamepad.index} index={gamepad.index} slot={index + 1} />
        ))
      )}
    </div>
  )
}

/** One controller, live: buttons light up, sticks move, triggers fill. */
function PadTester({ index, slot }: { index: number; slot: number }) {
  const [pad, setPad] = useState<Gamepad | null>(null)
  const frame = useRef(0)
  useEffect(() => {
    const tick = () => {
      setPad(navigator.getGamepads()[index] ?? null)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [index])
  if (!pad) return null

  const axis = (i: number) => pad.axes[i] ?? 0
  const value = (i: number) => pad.buttons[i]?.value ?? 0
  const rumble = () =>
    pad.vibrationActuator
      ?.playEffect('dual-rumble', { duration: 300, strongMagnitude: 0.8, weakMagnitude: 0.6 })
      .catch(() => undefined)

  return (
    <section className="card pad-tester">
      <header className="card__head">
        <span className="pad-tester__who">
          <PlayerBadge slot={slot} />
          <span className="card__title">{padName(pad)}</span>
        </span>
        {pad.vibrationActuator && (
          <button type="button" className="button button--small button--secondary" onClick={rumble}>
            {t.settings.rumble}
          </button>
        )}
      </header>
      <div className="pad-tester__body">
        <Stick label={t.settings.leftStick} x={axis(0)} y={axis(1)} />
        <div className="pad-tester__buttons">
          {BUTTONS.map((name, i) =>
            i < pad.buttons.length ? (
              <span key={name} className="pad-key" data-pressed={value(i) > 0.5 || undefined}>
                {name}
              </span>
            ) : null,
          )}
          <Trigger label="LT" value={value(6)} />
          <Trigger label="RT" value={value(7)} />
        </div>
        <Stick label={t.settings.rightStick} x={axis(2)} y={axis(3)} />
      </div>
      {pad.mapping !== 'standard' && <p className="field__help">{t.settings.nonStandard}</p>}
    </section>
  )
}

function Trigger({ label, value }: { label: string; value: number }) {
  return (
    <span className="pad-trigger">
      <span className="pad-trigger__label">{label}</span>
      <span className="pad-trigger__fill" style={{ transform: `scaleX(${value})` }} />
    </span>
  )
}

function Stick({ label, x, y }: { label: string; x: number; y: number }) {
  return (
    <figure className="stick">
      <span className="stick__well">
        <span
          className="stick__dot"
          style={{
            transform: `translate(${(x * STICK_TRAVEL).toFixed(0)}%, ${(y * STICK_TRAVEL).toFixed(0)}%)`,
          }}
        />
      </span>
      <figcaption className="field__help num">
        {label} {x.toFixed(2)} {y.toFixed(2)}
      </figcaption>
    </figure>
  )
}

function KeyboardTab() {
  return (
    <div className="stack stack--loose">
      <p className="muted">{t.settings.keyboardLead}</p>
      <section className="card">
        <KeyboardHelp />
      </section>
      <p className="muted">{t.settings.mouseLead}</p>
    </div>
  )
}

function AppTab() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    if (isDesktop)
      getVersion()
        .then(setVersion)
        .catch(() => setVersion(null))
  }, [])
  return (
    <div className="stack stack--loose">
      <Section title={t.settings.languageTitle}>
        <div className="card">
          <LanguagePicker />
        </div>
      </Section>
      <Section title={t.settings.aboutTitle}>
        <ul className="list">
          <li className="list__item">
            <span className="list__main">
              <span className="list__title">
                {isDesktop ? t.settings.desktopApp : t.settings.webApp}
              </span>
              <span className="list__detail">
                {version ? t.settings.version(version) : location.host}
              </span>
            </span>
          </li>
          <li className="list__item">
            <Link to="/conditions" className="list__title">
              {t.footer.terms}
            </Link>
          </li>
          <li className="list__item">
            <Link to="/confidentialite" className="list__title">
              {t.footer.privacy}
            </Link>
          </li>
        </ul>
      </Section>
    </div>
  )
}

function LanguagePicker() {
  const [choice, setChoice] = useState<LanguageChoice>(chosenLanguage)
  return (
    <fieldset className="choice">
      <legend className="choice__label">{t.settings.languageLabel}</legend>
      {(['auto', 'fr', 'en'] as const).map((option) => (
        <label key={option} className="choice__option">
          <input
            type="radio"
            name="language"
            checked={choice === option}
            onChange={() => {
              setChoice(option)
              setLanguage(option)
            }}
          />
          {t.settings.languages[option]}
        </label>
      ))}
    </fieldset>
  )
}
