import { useEffect, useState } from 'react'

const NAVIGATE_EVENT = 'couchwarp:navigate'

/** Changes page without reloading, so the session and the account stay in memory. */
export function navigate(path: string): void {
  history.pushState(null, '', path)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

/** The current path, updated on back, forward and `navigate`. */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const update = () => setPath(location.pathname)
    window.addEventListener('popstate', update)
    window.addEventListener(NAVIGATE_EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener(NAVIGATE_EVENT, update)
    }
  }, [])
  return path
}
