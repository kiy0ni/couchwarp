import { isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { useCallback, useEffect, useState } from 'react'
import { isDesktop } from './lib/desktop'
import { navigate, usePath } from './lib/router'
import type { EndReason } from './lib/session'
import { Admin } from './screens/Admin'
import { Browse } from './screens/Browse'
import { Console } from './screens/Console'
import { Ended } from './screens/Ended'
import { Friends } from './screens/Friends'
import { Home } from './screens/Home'
import { Host } from './screens/Host'
import { HostBubble } from './screens/HostBubble'
import { Join } from './screens/Join'
import { Legal } from './screens/Legal'
import { Play } from './screens/Play'
import { BadgesPage, Profile } from './screens/Profile'
import { Settings } from './screens/Settings'

/** A shared link is `/<code>`; the host console is `/<code>/console#key=…`. */
function parsePath(pathname: string): { code: string | null; isConsole: boolean } {
  const [first = '', second, ...rest] = pathname.slice(1).split('/')
  const code = normalizeRoomCode(decodeURIComponent(first))
  const isConsole = second === 'console' && rest.length === 0
  if (!isRoomCode(code) || (second !== undefined && !isConsole)) {
    return { code: null, isConsole: false }
  }
  return { code, isConsole }
}

type Stage =
  | { name: 'join' }
  | { name: 'play'; nickname: string }
  | { name: 'ended'; reason: EndReason }

export function App() {
  const path = usePath()
  const { code, isConsole } = parsePath(path)
  const [stage, setStage] = useState<Stage>({ name: 'join' })

  // Every new page starts at the join step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on path change only
  useEffect(() => setStage({ name: 'join' }), [path])

  const goTo = useCallback((next: string | null) => navigate(next ? `/${next}` : '/'), [])
  const onEnd = useCallback((reason: EndReason) => setStage({ name: 'ended', reason }), [])
  const onClosed = useCallback(() => onEnd('room-not-found'), [onEnd])

  // `/compte` is the address sign-in links of earlier versions return to.
  if (path === '/compte' || path === '/parametres' || path.startsWith('/parametres/')) {
    return <Settings path={path === '/compte' ? '/parametres/compte' : path} />
  }
  if (path === '/heberger') return <Host />
  if (path === '/badges') return <BadgesPage />
  const profile = path.match(/^\/profil\/([0-9a-zA-Z-]{1,64})$/)?.[1]
  if (profile) return <Profile userId={profile} />
  if (path === '/bulle' && isDesktop) return <HostBubble />
  if (path === '/parties') return <Browse />
  if (path === '/amis') return <Friends />
  if (path === '/moderation') return <Admin />
  if (path === '/conditions') return <Legal page="terms" />
  if (path === '/confidentialite') return <Legal page="privacy" />
  if (!code) return <Home onFound={goTo} />
  if (isConsole && stage.name !== 'ended') return <Console code={code} onEnd={onEnd} />
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
