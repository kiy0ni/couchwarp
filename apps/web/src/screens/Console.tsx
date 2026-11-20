import { useState } from 'react'
import { Page } from '../components/Page'
import { InviteLink, RoomManager } from '../components/RoomManager'
import { Shell } from '../components/Shell'
import { t } from '../i18n'
import { type ConsoleEnd, consoleKeyFromHash } from '../lib/console-session'

interface Props {
  code: string
  onEnd(reason: ConsoleEnd): void
}

/**
 * The host console from any device: the host app shows its link, and the key in the
 * link's fragment is what makes this page the host's.
 */
export function Console({ code, onEnd }: Props) {
  const [key] = useState(() => consoleKeyFromHash(location.hash))
  return (
    <Shell>
      <Page title={t.console.title} lead={key ? undefined : t.console.noKey}>
        {key && (
          <>
            <section className="card">
              <InviteLink code={code} />
            </section>
            <RoomManager code={code} consoleKey={key} onEnd={onEnd} />
          </>
        )}
      </Page>
    </Shell>
  )
}
