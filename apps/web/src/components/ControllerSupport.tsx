import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { desktop, type ControllerSupport as Support, system } from '../lib/desktop'

type Step = { kind: 'checking' } | { kind: 'known'; support: Support } | { kind: 'installing' }

/**
 * Whether guests' controllers reach games on this computer, and the one button that
 * installs what is missing. Only in the desktop app. `quiet` shows nothing once ready.
 */
export function ControllerSupport({ quiet = false }: { quiet?: boolean }) {
  const [step, setStep] = useState<Step>({ kind: 'checking' })
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    desktop
      .controllerSupport()
      .then((support) => setStep({ kind: 'known', support }))
      .catch((reason) => setError(String(reason)))
  }, [])

  async function install() {
    setError(null)
    setStep({ kind: 'installing' })
    try {
      setStep({ kind: 'known', support: await desktop.installControllerSupport() })
    } catch (reason) {
      setError(String(reason))
      setStep({ kind: 'known', support: 'missing' })
    }
  }

  if (step.kind === 'checking') return null
  const support = step.kind === 'known' ? step.support : null
  if (quiet && support !== 'missing') return null
  const s = t.controllerSupport
  const text =
    step.kind === 'installing'
      ? s.installing
      : support === 'ready'
        ? s.ready
        : support === 'stopped'
          ? s.stopped
          : support === 'impossible'
            ? s.impossible
            : system === 'linux'
              ? s.missingLinux
              : s.missingWindows
  return (
    <div
      className="notice"
      data-tone={support === 'missing' ? 'warning' : undefined}
      role="status"
      aria-busy={step.kind === 'installing' || undefined}
    >
      <p>
        <span className="notice__title">{s.title}</span>
        {text}
        {error && <span className="notice__error">{s.failed(error)}</span>}
      </p>
      {support === 'missing' && (
        <button type="button" className="button button--small" onClick={install}>
          {system === 'linux' ? s.allowLinux : s.install}
        </button>
      )}
    </div>
  )
}
