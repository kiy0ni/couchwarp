import type { ReportDecision } from '@couchwarp/protocol'
import { useCallback, useEffect, useState } from 'react'
import { Choice } from '../components/Choice'
import { TopBar } from '../components/TopBar'
import { t } from '../i18n'
import { accountRequest, useAccount } from '../lib/account'
import { useGamepadNavigation } from '../lib/gamepad-nav'
import { navigate } from '../lib/router'

interface Report {
  id: string
  roomCode: string
  roomTitle: string
  targetName: string | null
  targetHasAccount: boolean
  reason: keyof typeof t.report.reasons
  details: string
  createdAt: number
  decision: ReportDecision | null
  decisionNote: string | null
  decidedAt: number | null
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const DEFAULT_SUSPENSION_DAYS = 7

/** Reports to handle, oldest first, and the ones already handled. */
export function Admin() {
  const { account } = useAccount()
  const [state, setState] = useState<'open' | 'decided'>('open')
  const [reports, setReports] = useState<Report[] | null>(null)
  useGamepadNavigation(true, () => navigate('/'))

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/reports?state=${state}`)
    if (response.ok) setReports(((await response.json()) as { reports: Report[] }).reports)
  }, [state])

  useEffect(() => {
    if (account?.isAdmin) load().catch(console.error)
  }, [account, load])

  if (account !== undefined && !account?.isAdmin) {
    return (
      <main className="screen">
        <TopBar />
        <p className="panel panel__lead">{t.admin.forbidden}</p>
      </main>
    )
  }

  return (
    <main className="screen">
      <TopBar />
      <div className="console">
        <header className="console__head">
          <h1 className="title">{t.admin.title}</h1>
          <Choice<'open' | 'decided'>
            label={t.admin.show}
            value={state}
            options={[
              ['open', t.admin.open],
              ['decided', t.admin.decided],
            ]}
            onChange={setState}
          />
        </header>
        {reports?.length === 0 && <p className="panel__lead">{t.admin.none}</p>}
        {reports?.map((report) => (
          <ReportCard key={report.id} report={report} onDecided={load} />
        ))}
      </div>
    </main>
  )
}

function ReportCard({ report, onDecided }: { report: Report; onDecided(): void }) {
  const [note, setNote] = useState('')
  const [days, setDays] = useState(DEFAULT_SUSPENSION_DAYS)

  async function decide(decision: ReportDecision) {
    const response = await accountRequest(`/api/admin/reports/${report.id}`, 'POST', {
      decision,
      note,
      suspendDays: days,
    })
    if (response.ok) onDecided()
  }

  return (
    <article className="console__block report">
      <h2 className="section-title">{t.admin.room(report.roomTitle, report.roomCode)}</h2>
      <p className="members__role">
        {report.targetName ? t.admin.about(report.targetName) : t.admin.aboutRoom}
        {report.targetHasAccount && ` (${t.admin.withAccount})`}
      </p>
      <p>
        <strong>{t.report.reasons[report.reason]}</strong>
      </p>
      {report.details && <p className="report__details">{report.details}</p>}
      <time className="members__role" dateTime={new Date(report.createdAt).toISOString()}>
        {when.format(report.createdAt)}
      </time>
      {report.decision ? (
        <div className="menu__note">
          <p>
            <strong>{t.admin.decisions[report.decision]}</strong>
          </p>
          {report.decisionNote && <p>{report.decisionNote}</p>}
        </div>
      ) : (
        <div className="stack">
          <div className="field">
            <label className="field__label" htmlFor={`note-${report.id}`}>
              {t.admin.noteLabel}
            </label>
            <textarea
              id={`note-${report.id}`}
              className="input input--area"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {report.targetHasAccount && (
            <div className="field">
              <label className="field__label" htmlFor={`days-${report.id}`}>
                {t.admin.daysLabel}
              </label>
              <input
                id={`days-${report.id}`}
                className="input"
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(event) => setDays(Number(event.target.value) || 1)}
              />
            </div>
          )}
          <div className="actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={!note.trim()}
              onClick={() => decide('dismissed')}
            >
              {t.admin.dismiss}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={!note.trim()}
              onClick={() => decide('room-closed')}
            >
              {t.admin.closeRoom}
            </button>
            {report.targetHasAccount && (
              <button
                type="button"
                className="button button--danger"
                disabled={!note.trim()}
                onClick={() => decide('account-suspended')}
              >
                {t.admin.suspend}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
