import { useEffect, useState } from 'react'

const POLL_MS = 500

/**
 * Controllers the browser exposes. Most browsers only list a controller after one of its
 * buttons is pressed, so the list is polled as well as updated on connection events.
 */
export function useGamepads(): Gamepad[] {
  const [gamepads, setGamepads] = useState<Gamepad[]>([])

  useEffect(() => {
    const refresh = () => {
      const connected = navigator.getGamepads().filter((g): g is Gamepad => g?.connected === true)
      setGamepads((previous) =>
        previous.length === connected.length &&
        previous.every((g, i) => g.index === connected[i]?.index)
          ? previous
          : connected,
      )
    }
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    window.addEventListener('gamepadconnected', refresh)
    window.addEventListener('gamepaddisconnected', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('gamepadconnected', refresh)
      window.removeEventListener('gamepaddisconnected', refresh)
    }
  }, [])

  return gamepads
}
