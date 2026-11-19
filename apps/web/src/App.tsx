import { isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { useCallback, useEffect, useState } from 'react'
import { navigate, usePath } from './lib/router'
import type { EndReason } from './lib/session'
import { AccountPage } from './screens/AccountPage'
import { Ended } from './screens/Ended'
import { Home } from './screens/Home'
import { Join } from './screens/Join'
import { Play } from './screens/Play'

/** A shared link is `/<code>`. */
function codeFromPath(pathname: string): string | null {
  const code = normalizeRoomCode(decodeURIComponent(pathname.slice(1)))
  return isRoomCode(code) ? code : null
}

type Stage =
  | { name: 'join' }
  | { name: 'play'; nickname: string }
  | { name: 'ended'; reason: EndReason }

export function App() {
  const path = usePath()
  const code = codeFromPath(path)
  const [stage, setStage] = useState<Stage>({ name: 'join' })

  // Every new page starts at the join step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on path change only
  useEffect(() => setStage({ name: 'join' }), [path])

  const goTo = useCallback((next: string | null) => navigate(next ? `/${next}` : '/'), [])
  const onEnd = useCallback((reason: EndReason) => setStage({ name: 'ended', reason }), [])
  const onClosed = useCallback(() => onEnd('room-not-found'), [onEnd])

  if (path === '/compte') return <AccountPage />
  if (!code) return <Home onFound={goTo} />
  switch (stage.name) {
    case 'join':
      return (
        <Join
          code={code}
          onPlay={(nickname) => setStage({ name: 'play', nickname })}
          onBack={() => goTo(null)}
          onClosed={onClosed}
        />
      )
    case 'play':
      return <Play code={code} name={stage.nickname} onEnd={onEnd} onLeave={() => goTo(null)} />
    case 'ended':
      return <Ended reason={stage.reason} onAgain={() => goTo(null)} />
  }
}
