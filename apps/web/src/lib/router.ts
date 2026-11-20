import { useEffect, useState } from 'react'

const NAVIGATE_EVENT = 'couchwarp:navigate'

/**
 * Addresses of earlier versions, which were in French, and where those pages are now.
 * Links already shared keep working: they are rewritten in place when the page opens.
 */
const MOVED: ReadonlyMap<string, string> = new Map([
  ['/compte', '/settings/account'],
  ['/parametres', '/settings'],
  ['/parametres/hote', '/settings/host'],
  ['/parametres/reseau', '/settings/network'],
  ['/parametres/raccourcis', '/settings/shortcuts'],
  ['/parametres/manettes', '/settings/controllers'],
  ['/parametres/compte', '/settings/account'],
  ['/parametres/application', '/settings/app'],
  ['/heberger', '/host'],
  ['/parties', '/rooms'],
  ['/amis', '/friends'],
  ['/conditions', '/terms'],
  ['/confidentialite', '/privacy'],
  ['/bulle', '/bubble'],
])

/** Where a page lives now, for an address that may come from an earlier version. */
export function currentAddress(pathname: string): string {
  const moved = MOVED.get(pathname)
  if (moved) return moved
  const profile = pathname.match(/^\/profil\/(.+)$/)?.[1]
  return profile ? `/profile/${profile}` : pathname
}

function readPath(): string {
  const path = currentAddress(location.pathname)
  if (path !== location.pathname) {
    history.replaceState(null, '', `${path}${location.search}${location.hash}`)
  }
  return path
}

/** Changes page without reloading, so the session and the account stay in memory. */
export function navigate(path: string): void {
  history.pushState(null, '', path)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

/** The current path, updated on back, forward and `navigate`. */
export function usePath(): string {
  const [path, setPath] = useState(readPath)
  useEffect(() => {
    const update = () => setPath(readPath())
    window.addEventListener('popstate', update)
    window.addEventListener(NAVIGATE_EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener(NAVIGATE_EVENT, update)
    }
  }, [])
  return path
}
