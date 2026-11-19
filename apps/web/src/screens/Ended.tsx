import { useEffect, useRef } from 'react'
import { Wordmark } from '../components/Wordmark'
import { t } from '../i18n'
import { useGamepadNavigation } from '../lib/gamepad-nav'
import type { EndReason } from '../lib/session'

export function Ended({ reason, onAgain }: { reason: EndReason; onAgain(): void }) {
  const action = useRef<HTMLButtonElement>(null)
  useGamepadNavigation(true)
  useEffect(() => action.current?.focus(), [])

  return (
    <main className="screen">
      <header className="topbar">
        <Wordmark />
      </header>
      <section className="panel" aria-labelledby="ended-title">
        <h1 id="ended-title" className="title">
          {t.ended.title}
        </h1>
        <p className="panel__lead">{t.ended.reasons[reason]}</p>
        <button ref={action} type="button" className="button" onClick={onAgain}>
          {t.ended.again}
        </button>
      </section>
    </main>
  )
}
