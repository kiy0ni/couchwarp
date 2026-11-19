import { MAX_REPORT_DETAILS, REPORT_REASONS, type ReportReason } from '@couchwarp/protocol'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { accountRequest } from '../lib/account'

/** Who is reported: a guest of the room, or the room itself when `guestId` is null. */
export interface ReportTarget {
  code: string
  guestId: number | null
  name: string
}

interface Props {
  target: ReportTarget | null
  onClose(): void
}

type Status = 'idle' | 'sending' | 'sent' | 'too-many' | 'failed'

/** A modal form: a reason, optional details, then a plain confirmation. */
export function ReportDialog({ target, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    if (!target) return
    setReason(null)
    setDetails('')
    setStatus('idle')
    dialog.current?.showModal()
  }, [target])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!target || !reason) return
    setStatus('sending')
    const response = await accountRequest(`/api/rooms/${target.code}/report`, 'POST', {
      guestId: target.guestId,
      reason,
      details,
    }).catch(() => null)
    setStatus(response?.ok ? 'sent' : response?.status === 429 ? 'too-many' : 'failed')
  }

  return (
    <dialog ref={dialog} className="menu" aria-labelledby="report-title" onClose={onClose}>
      <h2 id="report-title" className="menu__title">
        {target?.guestId === null ? t.report.titleRoom : t.report.title(target?.name ?? '')}
      </h2>
      {status === 'sent' ? (
        <>
          <p className="menu__note">{t.report.sent}</p>
          <div className="menu__actions">
            <button type="button" className="button" onClick={() => dialog.current?.close()}>
              {t.play.closeMenu}
            </button>
          </div>
        </>
      ) : (
        <form className="stack" onSubmit={submit}>
          <fieldset className="choice choice--column">
            <legend className="choice__label">{t.report.reasonLabel}</legend>
            {REPORT_REASONS.map((option) => (
              <label key={option} className="choice__option">
                <input
                  type="radio"
                  name="report-reason"
                  checked={reason === option}
                  onChange={() => setReason(option)}
                />
                {t.report.reasons[option]}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label className="field__label" htmlFor="report-details">
              {t.report.detailsLabel}
            </label>
            <textarea
              id="report-details"
              className="input input--area"
              value={details}
              maxLength={MAX_REPORT_DETAILS}
              rows={3}
              onChange={(event) => setDetails(event.target.value)}
            />
          </div>
          {status === 'too-many' && (
            <p className="field__help" data-error>
              {t.report.tooMany}
            </p>
          )}
          {status === 'failed' && (
            <p className="field__help" data-error>
              {t.report.failed}
            </p>
          )}
          <div className="menu__actions">
            <button type="submit" className="button" disabled={!reason || status === 'sending'}>
              {t.report.send}
            </button>
            <button type="button" className="link-button" onClick={() => dialog.current?.close()}>
              {t.report.cancel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
