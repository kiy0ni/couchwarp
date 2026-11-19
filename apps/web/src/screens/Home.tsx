import { ROOM_CODE_LENGTH } from '@couchwarp/protocol'
import { type FormEvent, useState } from 'react'
import { CodeEntry } from '../components/CodeEntry'
import { Footer } from '../components/Footer'
import { TopBar } from '../components/TopBar'
import { t } from '../i18n'
import { useGamepadNavigation } from '../lib/gamepad-nav'
import { navigate } from '../lib/router'
import { isRoomOpen } from '../lib/session'
import { useGamepads } from '../lib/use-gamepads'

type Status = { kind: 'idle' } | { kind: 'looking' } | { kind: 'error'; message: string }

export function Home({ onFound }: { onFound(code: string): void }) {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const gamepads = useGamepads()
  useGamepadNavigation(true)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (code.length < ROOM_CODE_LENGTH) {
      setStatus({ kind: 'error', message: t.home.incomplete })
      return
    }
    setStatus({ kind: 'looking' })
    try {
      if (await isRoomOpen(code)) onFound(code)
      else setStatus({ kind: 'error', message: t.home.notFound })
    } catch (error) {
      console.error(error)
      setStatus({ kind: 'error', message: t.home.serverDown })
    }
  }

  const error = status.kind === 'error' ? status.message : null

  return (
    <main className="screen">
      <TopBar />
      <form className="panel" onSubmit={submit} noValidate>
        <h1 className="title">{t.home.title}</h1>
        <div className="field">
          <label className="field__label" htmlFor="room-code">
            {t.home.codeLabel}
          </label>
          <CodeEntry
            id="room-code"
            value={code}
            onChange={(next) => {
              setCode(next)
              if (status.kind === 'error') setStatus({ kind: 'idle' })
            }}
            invalid={error !== null}
            describedBy="room-code-help"
          />
          <p id="room-code-help" className="field__help" data-error={error ? true : undefined}>
            {error ?? (gamepads.length > 0 ? t.home.gamepadHelp : t.home.codeHelp)}
          </p>
        </div>
        <button type="submit" className="button" disabled={status.kind === 'looking'}>
          {status.kind === 'looking' ? t.home.looking : t.home.join}
        </button>
        <a
          className="link-button"
          href="/parties"
          onClick={(event) => {
            event.preventDefault()
            navigate('/parties')
          }}
        >
          {t.browse.link}
        </a>
      </form>
      <Footer />
    </main>
  )
}
