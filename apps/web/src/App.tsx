import { isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { useCallback, useEffect, useState } from 'react'
import type { EndReason } from './lib/session'
import { Ended } from './screens/Ended'
import { Home } from './screens/Home'
import { Join } from './screens/Join'
import { Play } from './screens/Play'

/** A shared link is `/<code>`; anything else opens the code entry. */
function codeFromPath(pathname: string): string | null {
  const code = normalizeRoomCode(decodeURIComponent(pathname.slice(1)))
  return isRoomCode(code) ? code : null
}

type Stage =
  | { name: 'join' }
  | { name: 'play'; nickname: string }
  | { name: 'ended'; reason: EndReason }

export function App() {
  const [code, setCode] = useState(() => codeFromPath(location.pathname))
  const [stage, setStage] = useState<Stage>({ name: 'join' })

  useEffect(() => {
    const onPopState = () => {
      setCode(codeFromPath(location.pathname))
      setStage({ name: 'join' })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const goTo = useCallback((next: string | null) => {
    history.pushState(null, '', next ? `/${next}` : '/')
    setCode(next)
    setStage({ name: 'join' })
  }, [])
  const onEnd = useCallback((reason: EndReason) => setStage({ name: 'ended', reason }), [])
  const onClosed = useCallback(() => onEnd('room-not-found'), [onEnd])

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
