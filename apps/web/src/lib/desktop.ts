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
      /** The game is behind another window: guests' keyboards and mice wait. */
      inputPaused: boolean
      publicNeedsAccount: boolean
    }

export interface StartRequest {
  windowId: string
  title: string | null
  game: string | null
  maxPlayers: number | null
  public: boolean
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

/** One input report of a PlayStation or Switch controller, as WebHID would give it. */
export interface NativeReport {
  vendorId: number
  productId: number
  reportId: number
  data: number[]
}

/** Whether guests' controllers play into games here, as the app finds it. */
export type ControllerSupport = 'ready' | 'stopped' | 'missing' | 'impossible'

/** The two permissions macOS asks for: recording the screen, sending keys and clicks. */
export type PermissionPane = 'screen' | 'input'

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
  /** Whether guests' keys and mice can reach the game. */
  inputAllowed: () => invoke<boolean>('input_allowed'),
  openPrivacySettings: (pane: PermissionPane) => invoke<void>('open_privacy_settings', { pane }),
  /** Forgets what macOS remembers for this permission, and asks again. */
  repairPermission: (pane: PermissionPane) => invoke<void>('repair_permission', { pane }),
  /** The app reads PlayStation and Switch controllers' reports and hands them over. */
  watchControllers: (onReport: (report: NativeReport) => void) => {
    const channel = new Channel<NativeReport>()
    channel.onmessage = onReport
    return invoke<void>('watch_controllers', { onReport: channel })
  },
  /** The controllers whose motion the app reads now. */
  motionControllers: () => invoke<string[]>('motion_controllers'),
  controllerSupport: () => invoke<ControllerSupport>('controller_support'),
  /** Installs what guests' controllers need (VIIPER on Windows, a udev rule on Linux). */
  installControllerSupport: () => invoke<ControllerSupport>('install_controller_support'),
  /** Starts the app again, ending a hosted game. */
  restartApp: () => invoke<void>('restart_app'),
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

/** Browser shortcuts that make no sense in an app: reload, print, find, view source, caret browsing. */
const BROWSER_KEYS = new Set([
  'F5',
  'F3',
  'F7',
  'KeyR',
  'KeyP',
  'KeyF',
  'KeyG',
  'KeyU',
  'KeyJ',
  'KeyH',
])

function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  )
}

/**
 * Makes the app's window behave like an app rather than a web page: its own scrolling and
 * text rules (`html[data-app]` in the styles), no browser context menu outside text fields,
 * no reload, print or find shortcuts.
 */
export function behaveAsApp(): void {
  document.documentElement.dataset.app = system
  document.addEventListener('contextmenu', (event) => {
    if (!editable(event.target)) event.preventDefault()
  })
  document.addEventListener(
    'keydown',
    (event) => {
      const modified = event.ctrlKey || event.metaKey
      const blocked = event.code.startsWith('F')
        ? BROWSER_KEYS.has(event.code) && !modified
        : modified && BROWSER_KEYS.has(event.code)
      // Only the browser's action goes: a game still gets the key (F5 included), since it
      // reads keys itself whether or not their default action was prevented.
      if (blocked) event.preventDefault()
    },
    true,
  )
}
