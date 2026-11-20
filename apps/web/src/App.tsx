import { isRoomCode, normalizeRoomCode } from '@couchwarp/protocol'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from './lib/account'
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
import { Login, loginModeOf } from './screens/Login'
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

  const { account } = useAccount()
  const loginMode = loginModeOf(path)
  // Links from e-mails work whether signed in or not, in the app as in a browser.
  if (loginMode === 'reset' || loginMode === 'confirm') return <Login mode={loginMode} />
  if (path === '/bubble' && isDesktop) return <HostBubble />
  if (path === '/terms') return <Legal page="terms" />
  if (path === '/privacy') return <Legal page="privacy" />
  // Everything else needs an account: the sign-in page stands in front, at the address
  // asked for, which shows once signed in (a game's link included).
  if (account === undefined) return <div className="splash" aria-busy="true" />
  if (account === null) return <Login mode={loginMode ?? 'signin'} />
  // A new account made with Discord or Google answers the age question once.
  if (!account.ageConfirmed) return <Login mode="signin" />
  if (loginMode) return <Login mode={loginMode} />

  // Addresses of earlier versions are already rewritten by `usePath`.
  if (path === '/settings' || path.startsWith('/settings/')) return <Settings path={path} />
  if (path === '/host') return <Host />
  if (path === '/badges') return <BadgesPage />
  const profile = path.match(/^\/profile\/([0-9a-zA-Z-]{1,64})$/)?.[1]
  if (profile) return <Profile userId={profile} />
  if (path === '/rooms') return <Browse />
  if (path === '/friends') return <Friends />
  if (path === '/moderation') return <Admin />
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
