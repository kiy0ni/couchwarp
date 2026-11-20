/**
 * The bridge to the desktop app (`apps/desktop`). Its window shows these same pages and
 * adds a few commands a browser cannot run: list and share a window, sign in through the
 * system browser. Everything here is unavailable, and never called, in a plain browser.
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** Whether this page runs inside the desktop app. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Which system the visitor is on, to offer the right download and draw the right window. */
export const system: 'mac' | 'windows' | 'linux' | 'other' = /Mac/.test(navigator.userAgent)
  ? 'mac'
  : /Windows/.test(navigator.userAgent)
    ? 'windows'
    : /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)
      ? 'linux'
      : 'other'

export interface WindowInfo {
  id: string
  app: string
  title: string
}

export interface HostStats {
  fps: number
  medianMs: number
  bitrateMbps: number
  guests: number
}

export type HostingState =
  | { state: 'idle'; error: string | null }
  | { state: 'starting'; window: WindowInfo }
  | {
      state: 'live'
      window: WindowInfo
      code: string
      consoleKey: string
      stats: HostStats | null
      noInputPermission: boolean
      publicNeedsAccount: boolean
    }

export interface StartRequest {
  windowId: string
  title: string | null
  game: string | null
  maxPlayers: number | null
  public: boolean
  relayOnly: boolean
  turnMinutes: number | null
  fps: number
  bitrateMbps: number
  maxHeight: number
  /** The computer and screen stay awake while the game runs. */
  keepAwake: boolean
  /** Guests' keys wait while the game window is not in front. */
  focusLock: boolean
  /** The small window over the game to manage it. */
  bubble: boolean
  /** UDP port for guests, 0 for any. */
  port: number
  stun: string
}

/** A newer version of the app, published and ready to install. */
export interface AvailableUpdate {
  version: string
  notes: string | null
}

/** Where an install has got to; `total` is null when the server gave no size. */
export type UpdateProgress =
  | { step: 'downloading'; done: number; total: number | null }
  | { step: 'installing' }

export const desktop = {
  listWindows: () => invoke<WindowInfo[]>('list_windows'),
  /** A small picture as a `data:` address, or null when the window shows nothing. */
  windowPreview: (id: string) => invoke<string | null>('window_preview', { id }),
  hostingState: () => invoke<HostingState>('hosting_state'),
  startHosting: (request: StartRequest) => invoke<void>('start_hosting', { request }),
  stopHosting: () => invoke<void>('stop_hosting'),
  onHosting: (handler: (state: HostingState) => void) =>
    listen<HostingState>('hosting', (event) => handler(event.payload)),
  /** The session this computer keeps, if the app signed in before. */
  savedSession: () => invoke<string | null>('saved_session'),
  /** Opens the system browser to sign in; resolves with the new session. */
  signIn: (provider: string) => invoke<string>('sign_in', { provider }),
  signOut: () => invoke<void>('sign_out'),
  /** Keeps a session signed in with a password, for hosting. */
  saveSession: (token: string) => invoke<void>('save_session', { token }),
  /** Whether guests' keys and mice can reach the game. A Mac asks the first time. */
  inputAllowed: () => invoke<boolean>('input_allowed'),
  openPrivacySettings: (pane: 'screen' | 'input') =>
    invoke<void>('open_privacy_settings', { pane }),
  /** The version the app found waiting, if any. Apps from before updates cannot answer. */
  updateAvailable: () => invoke<AvailableUpdate | null>('update_available'),
  onUpdate: (handler: (update: AvailableUpdate) => void) =>
    listen<AvailableUpdate>('update', (event) => handler(event.payload)),
  /** Downloads and installs the waiting version; the app then restarts into it. */
  installUpdate: (onProgress: (progress: UpdateProgress) => void) => {
    const channel = new Channel<UpdateProgress>()
    channel.onmessage = onProgress
    return invoke<void>('install_update', { onProgress: channel })
  },
}

/** Gives this window the account the app signed in with. */
export async function adoptAppSession(token: string): Promise<boolean> {
  const response = await fetch('/api/auth/app-session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.ok
}
