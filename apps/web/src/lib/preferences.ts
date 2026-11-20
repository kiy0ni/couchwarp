import { useSyncExternalStore } from 'react'

/**
 * Choices kept on this device, from the Settings page: how games look and behave for
 * this guest, and the host app's defaults. Nothing here leaves the device.
 */
export interface Preferences {
  /** Enter full screen as soon as the game starts. */
  fullscreenOnStart: boolean
  /** The latency always shows on the in-game bubble, or only in its menu. */
  latencyOnBubble: boolean
  /** A notice over the game when the connection struggles. */
  connectionWarnings: boolean
  /** New chat messages show over the game for a few seconds. */
  chatOverGame: boolean
  /** The on-screen controller on touch screens. */
  touchPad: boolean
  /** How the keyboard plays when the host allows it: as keys, or as a controller. */
  keyboardMode: 'keys' | 'pad'
  /** The controller the game sees for this guest. */
  padType: 'xbox360' | 'dualshock4'
  /** Nintendo controllers play by their letters: the A on the right is the game's A. */
  nintendoLetters: boolean
  /** The phone's own gyroscope moves the touch controller. */
  phoneMotion: boolean
  /** Mouse movement multiplier, 0.25 to 3. */
  mouseSpeed: number
  /** Where the in-game bubble sits, as fractions of the screen. */
  bubble: { x: number; y: number }

  /** Host app: tallest picture sent, in pixels. */
  hostMaxHeight: 720 | 1080 | 1440
  hostFps: 30 | 60
  /** Host app: highest bitrate, Mbit/s; it drops to fit the weakest guest. */
  hostBitrate: number
  /** Host app: the computer stays awake while a game is running. */
  hostKeepAwake: boolean
  /** Host app, Mac: guests' keys wait while the game window is not in front. */
  hostFocusLock: boolean
  /** Host app: a small window over the game to manage it. */
  hostBubble: boolean
  /** Host app: UDP port for guests, 0 for any free one. */
  hostPort: number
  /** Host app: STUN server that tells this computer its public address. */
  hostStun: string
}

export const DEFAULT_PREFERENCES: Preferences = {
  fullscreenOnStart: false,
  latencyOnBubble: true,
  connectionWarnings: true,
  chatOverGame: true,
  touchPad: true,
  keyboardMode: 'pad',
  padType: 'xbox360',
  nintendoLetters: true,
  phoneMotion: false,
  mouseSpeed: 1,
  bubble: { x: 0.5, y: 0.02 },
  hostMaxHeight: 1080,
  hostFps: 60,
  hostBitrate: 12,
  hostKeepAwake: true,
  hostFocusLock: true,
  hostBubble: true,
  hostPort: 0,
  hostStun: 'stun.cloudflare.com:3478',
}

const KEY = 'couchwarp.preferences'
const listeners = new Set<() => void>()

function read(): Preferences {
  try {
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    // Blocked storage or an old shape: defaults are always safe.
    return DEFAULT_PREFERENCES
  }
}

let current = read()

export function preferences(): Preferences {
  return current
}

export function setPreferences(patch: Partial<Preferences>): void {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // The choice still holds until the page closes.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The preferences, re-rendering when one changes. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, preferences)
}
