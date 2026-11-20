/**
 * The shared state of a room, and the commands that change it. The room server holds
 * the state and sends it whole after every change; the host, the guests and the host
 * console only render it.
 */

import type { GuestId } from './signal'
import { asObject, isInteger } from './validate'

export type GuestRole = 'moderator' | 'player' | 'spectator'
export type Visibility = 'link' | 'public'
export type PadType = 'xbox360' | 'dualshock4'
export type HotseatMode = 'off' | 'manual' | 'timer'

export const MAX_PLAYERS = 8
export const MAX_TITLE_LENGTH = 60
export const MAX_CHAT_LENGTH = 300

export interface RoomSettings {
  title: string
  game: string
  /** Guests who may hold a controller at once, 1 to 8. The rest watch. */
  maxPlayers: number
  visibility: Visibility
  /** Guests connect through the relay only, so the host never sees their address. */
  relayOnly: boolean
  /** Players take turns: by hand, or every `minutes`. */
  hotseat: { mode: HotseatMode; minutes: number }
}

export const DEFAULT_SETTINGS: RoomSettings = {
  title: '',
  game: '',
  maxPlayers: 4,
  visibility: 'link',
  // Guests' addresses stay hidden unless the host chooses otherwise (when a relay exists).
  relayOnly: true,
  hotseat: { mode: 'off', minutes: 5 },
}

export interface Member {
  id: GuestId
  name: string
  avatarUrl: string | null
  /** Set when the guest is signed in. */
  userId: string | null
  role: GuestRole
  /** Controllers are on by default; the host can take them away from one guest. */
  pads: boolean
  /** Keyboard and mouse are off by default: a controller cannot leave the game. */
  keyboard: boolean
  mouse: boolean
  padType: PadType
}

export interface RoomState {
  code: string
  settings: RoomSettings
  hostName: string
  members: Member[]
  /** Spectators waiting for a controller, first in line first. */
  queue: GuestId[]
  /** When the current turn ends, in Unix ms, with the timer hotseat. */
  turnEndsAt: number | null
  /** Why `public` was turned down, when it was. */
  publicRefused: 'sign-in-required' | 'disabled' | null
  /** Whether a relay is configured on the server; `relayOnly` needs one. */
  relayAvailable: boolean
}

/** What the host, its console or a moderator can ask the room to do. */
export type HostCommand =
  | { type: 'configure'; settings: RoomSettings }
  | { type: 'set-role'; guestId: GuestId; role: GuestRole }
  | { type: 'set-permissions'; guestId: GuestId; pads: boolean; keyboard: boolean; mouse: boolean }
  | { type: 'set-pad-type'; guestId: GuestId; padType: PadType }
  | { type: 'kick'; guestId: GuestId; ban: boolean }
  | { type: 'next-turn' }
  | { type: 'chat'; text: string }
  | { type: 'close' }

export interface ChatMessage {
  /** Null for the host. */
  from: GuestId | null
  name: string
  text: string
  at: number
}

const ROLES: readonly GuestRole[] = ['moderator', 'player', 'spectator']
const PAD_TYPES: readonly PadType[] = ['xbox360', 'dualshock4']
const HOTSEAT_MODES: readonly HotseatMode[] = ['off', 'manual', 'timer']

/**
 * Cleans what people type: line breaks and tabs become spaces, other control characters
 * go, spaces collapse, and the length is capped in characters (an emoji counts as one).
 */
export function cleanText(raw: string, maxLength: number): string {
  return [
    ...raw
      .replace(/\s+/g, ' ')
      .replace(/\p{Cc}/gu, '')
      .trim(),
  ]
    .slice(0, maxLength)
    .join('')
}

export function parseSettings(value: unknown): RoomSettings | null {
  const settings = asObject(value)
  const hotseat = asObject(settings?.hotseat)
  if (
    !settings ||
    !hotseat ||
    typeof settings.title !== 'string' ||
    typeof settings.game !== 'string' ||
    !isInteger(settings.maxPlayers, 1, MAX_PLAYERS) ||
    (settings.visibility !== 'link' && settings.visibility !== 'public') ||
    typeof settings.relayOnly !== 'boolean' ||
    !HOTSEAT_MODES.includes(hotseat.mode as HotseatMode) ||
    !isInteger(hotseat.minutes, 1, 60)
  ) {
    return null
  }
  return {
    title: cleanText(settings.title, MAX_TITLE_LENGTH),
    game: cleanText(settings.game, MAX_TITLE_LENGTH),
    maxPlayers: settings.maxPlayers,
    visibility: settings.visibility,
    relayOnly: settings.relayOnly,
    hotseat: { mode: hotseat.mode as HotseatMode, minutes: hotseat.minutes },
  }
}

const MAX_GUEST_ID = 2 ** 32 - 1

export function parseHostCommand(value: unknown): HostCommand | null {
  const command = asObject(value)
  const guestId = command?.guestId
  switch (command?.type) {
    case 'configure': {
      const settings = parseSettings(command.settings)
      return settings ? { type: 'configure', settings } : null
    }
    case 'set-role':
      return isInteger(guestId, 0, MAX_GUEST_ID) && ROLES.includes(command.role as GuestRole)
        ? { type: 'set-role', guestId, role: command.role as GuestRole }
        : null
    case 'set-permissions':
      return isInteger(guestId, 0, MAX_GUEST_ID) &&
        typeof command.pads === 'boolean' &&
        typeof command.keyboard === 'boolean' &&
        typeof command.mouse === 'boolean'
        ? {
            type: 'set-permissions',
            guestId,
            pads: command.pads,
            keyboard: command.keyboard,
            mouse: command.mouse,
          }
        : null
    case 'set-pad-type':
      return isInteger(guestId, 0, MAX_GUEST_ID) && PAD_TYPES.includes(command.padType as PadType)
        ? { type: 'set-pad-type', guestId, padType: command.padType as PadType }
        : null
    case 'kick':
      return isInteger(guestId, 0, MAX_GUEST_ID) && typeof command.ban === 'boolean'
        ? { type: 'kick', guestId, ban: command.ban }
        : null
    case 'next-turn':
      return { type: 'next-turn' }
    case 'chat': {
      const text = typeof command.text === 'string' ? cleanText(command.text, MAX_CHAT_LENGTH) : ''
      return text ? { type: 'chat', text } : null
    }
    case 'close':
      return { type: 'close' }
    default:
      return null
  }
}
