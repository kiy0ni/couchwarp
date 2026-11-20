import { useEffect, useRef } from 'react'
import { Page } from '../components/Page'
import { Shell } from '../components/Shell'
import { t } from '../i18n'
import type { EndReason } from '../lib/session'

export function Ended({ reason, onAgain }: { reason: EndReason; onAgain(): void }) {
  const action = useRef<HTMLButtonElement>(null)
  useEffect(() => action.current?.focus(), [])

  return (
    <Shell onBack={onAgain}>
      <Page title={t.ended.title} lead={t.ended.reasons[reason]} width="narrow">
        <div className="actions">
          <button ref={action} type="button" className="button" onClick={onAgain}>
            {t.ended.again}
          </button>
        </div>
      </Page>
    </Shell>
  )
}
