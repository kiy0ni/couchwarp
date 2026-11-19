/**
 * Everything a room knows and every rule it applies, without any network or storage.
 * The Durable Object (`room.ts`) feeds it events and sends out what it returns.
 */

import {
  type ChatMessage,
  DEFAULT_SETTINGS,
  type GuestId,
  type GuestRole,
  type HostCommand,
  MAX_CHAT_LENGTH,
  type Member,
  type PadType,
  type RejectReason,
  type RoomSettings,
  type RoomState,
} from '@couchwarp/protocol'

/** People in a room besides the host, players and spectators together. */
export const MAX_MEMBERS = 16
const CHAT_HISTORY = 50
const CHAT_INTERVAL_MS = 1000

export interface Account {
  userId: string
  displayName: string
  avatarUrl: string | null
}

/** Who sends a command: the host (its app or its console), or a guest. */
export type Actor = { kind: 'host' } | { kind: 'guest'; guestId: GuestId }

export interface HostInfo {
  name: string
  userId: string | null
}

interface StoredMember extends Member {
  /** Ban keys: the account, and a hash of the network address. */
  banKeys: string[]
  /** When this member last became a player, to rotate the longest-playing first. */
  playingSince: number
  lastChatAt: number
}

export interface Snapshot {
  settings: RoomSettings
  host: HostInfo
  members: StoredMember[]
  queue: GuestId[]
  bans: string[]
  turnEndsAt: number | null
  chat: ChatMessage[]
}

export type Outcome =
  | { ok: true; chat?: ChatMessage; kicked?: GuestId; closed?: true }
  | { ok: false; reason: 'forbidden' | 'unknown-guest' | 'too-fast' | 'not-allowed' }

export interface Policy {
  publicRoomsEnabled: boolean
  relayAvailable: boolean
}

const FORBIDDEN: Outcome = { ok: false, reason: 'forbidden' }
const UNKNOWN: Outcome = { ok: false, reason: 'unknown-guest' }
const DONE: Outcome = { ok: true }

export class RoomModel {
  private constructor(
    readonly code: string,
    private snapshot: Snapshot,
  ) {}

  static create(code: string, host: HostInfo): RoomModel {
    return new RoomModel(code, {
      // A signed-out host has no name: the pages say "the host" in the reader's language.
      settings: { ...DEFAULT_SETTINGS, title: host.name ? `Partie de ${host.name}` : '' },
      host,
      members: [],
      queue: [],
      bans: [],
      turnEndsAt: null,
      chat: [],
    })
  }

  static restore(code: string, snapshot: Snapshot): RoomModel {
    return new RoomModel(code, snapshot)
  }

  save(): Snapshot {
    return this.snapshot
  }

  get settings(): RoomSettings {
    return this.snapshot.settings
  }

  get host(): HostInfo {
    return this.snapshot.host
  }

  get chatHistory(): ChatMessage[] {
    return this.snapshot.chat
  }

  get turnEndsAt(): number | null {
    return this.snapshot.turnEndsAt
  }

  /** Visibility as applied: public only for a signed-in host, when public rooms are on. */
  effectiveVisibility(policy: Policy): RoomSettings['visibility'] {
    return this.publicRefused(policy) ? 'link' : this.settings.visibility
  }

  member(guestId: GuestId): Member | undefined {
    return this.find(guestId)
  }

  players(): Member[] {
    return this.seated().map(publicMember)
  }

  state(policy: Policy): RoomState {
    return {
      code: this.code,
      settings: this.settings,
      hostName: this.host.name,
      members: this.snapshot.members.map(publicMember),
      queue: this.snapshot.queue,
      turnEndsAt: this.snapshot.turnEndsAt,
      publicRefused: this.publicRefused(policy),
      relayAvailable: policy.relayAvailable,
    }
  }

  /** Adds a guest, as a player while seats are left, else as a spectator. */
  join(
    guestId: GuestId,
    name: string,
    account: Account | null,
    banKeys: string[],
    now: number,
  ): Member | RejectReason {
    if (banKeys.some((key) => this.snapshot.bans.includes(key))) return 'banned'
    if (this.snapshot.members.length >= MAX_MEMBERS) return 'room-full'
    const member: StoredMember = {
      id: guestId,
      name,
      avatarUrl: account?.avatarUrl ?? null,
      userId: account?.userId ?? null,
      role: this.seated().length < this.settings.maxPlayers ? 'player' : 'spectator',
      keyboard: false,
      mouse: false,
      padType: 'xbox360',
      banKeys,
      playingSince: now,
      lastChatAt: 0,
    }
    this.snapshot.members.push(member)
    return publicMember(member)
  }

  leave(guestId: GuestId, now: number): void {
    this.snapshot.members = this.snapshot.members.filter((m) => m.id !== guestId)
    this.snapshot.queue = this.snapshot.queue.filter((id) => id !== guestId)
    this.fillSeats(now)
  }

  raiseHand(guestId: GuestId, raised: boolean): Outcome {
    const member = this.find(guestId)
    if (!member) return UNKNOWN
    if (member.role !== 'spectator') return { ok: false, reason: 'not-allowed' }
    this.snapshot.queue = this.snapshot.queue.filter((id) => id !== guestId)
    if (raised) this.snapshot.queue.push(guestId)
    return DONE
  }

  apply(actor: Actor, command: HostCommand, now: number): Outcome {
    const role = this.actorRole(actor)
    if (role === null) return UNKNOWN
    switch (command.type) {
      case 'chat':
        return this.chat(actor, command.text, now)
      case 'set-pad-type':
        return role === 'host' || (actor.kind === 'guest' && actor.guestId === command.guestId)
          ? this.setPadType(command.guestId, command.padType)
          : FORBIDDEN
      case 'set-role':
        return this.setRole(role, command.guestId, command.role, now)
      case 'kick':
        return this.kick(role, command.guestId, command.ban)
      case 'next-turn':
        if (role !== 'host' && role !== 'moderator') return FORBIDDEN
        this.nextTurn(now)
        return DONE
      case 'configure':
        if (role !== 'host') return FORBIDDEN
        this.configure(command.settings, now)
        return DONE
      case 'set-permissions': {
        if (role !== 'host') return FORBIDDEN
        const target = this.find(command.guestId)
        if (!target) return UNKNOWN
        target.keyboard = command.keyboard
        target.mouse = command.mouse
        return DONE
      }
      case 'close':
        return role === 'host' ? { ok: true, closed: true } : FORBIDDEN
    }
  }

  /**
   * Hotseat rotation: the player who has played longest gives their controller to the
   * first spectator in line, and joins the end of the line.
   */
  nextTurn(now: number): void {
    const next = this.snapshot.queue[0]
    const out = this.snapshot.members
      .filter((m) => m.role === 'player')
      .sort((a, b) => a.playingSince - b.playingSince)[0]
    if (next !== undefined && out) {
      const incoming = this.find(next)
      if (incoming) {
        out.role = 'spectator'
        incoming.role = 'player'
        incoming.playingSince = now
        this.snapshot.queue = [...this.snapshot.queue.slice(1), out.id]
      }
    }
    this.snapshot.turnEndsAt =
      this.settings.hotseat.mode === 'timer' ? now + this.settings.hotseat.minutes * 60_000 : null
  }

  private configure(settings: RoomSettings, now: number): void {
    const timerChanged =
      settings.hotseat.mode !== this.settings.hotseat.mode ||
      settings.hotseat.minutes !== this.settings.hotseat.minutes
    this.snapshot.settings = settings
    // Fewer seats: the latest players watch instead.
    const players = this.seated().sort((a, b) => a.playingSince - b.playingSince)
    for (const extra of players.slice(settings.maxPlayers)) extra.role = 'spectator'
    this.fillSeats(now)
    if (timerChanged) {
      this.snapshot.turnEndsAt =
        settings.hotseat.mode === 'timer' ? now + settings.hotseat.minutes * 60_000 : null
    }
  }

  private setRole(actorRole: ActorRole, guestId: GuestId, role: GuestRole, now: number): Outcome {
    const target = this.find(guestId)
    if (!target) return UNKNOWN
    if (actorRole === 'moderator' && (role === 'moderator' || target.role === 'moderator')) {
      return FORBIDDEN
    }
    if (actorRole !== 'host' && actorRole !== 'moderator') return FORBIDDEN
    if (role !== 'spectator' && target.role === 'spectator' && this.seatsLeft() === 0) {
      return { ok: false, reason: 'not-allowed' }
    }
    if (role !== 'spectator' && target.role === 'spectator') target.playingSince = now
    target.role = role
    this.snapshot.queue = this.snapshot.queue.filter((id) => id !== guestId)
    // The seat they leave goes to someone else, never straight back to them.
    if (role === 'spectator') this.fillSeats(now, guestId)
    return DONE
  }

  private kick(actorRole: ActorRole, guestId: GuestId, ban: boolean): Outcome {
    const target = this.find(guestId)
    if (!target) return UNKNOWN
    if (actorRole === 'moderator' && target.role === 'moderator') return FORBIDDEN
    if (actorRole !== 'host' && actorRole !== 'moderator') return FORBIDDEN
    if (ban) this.snapshot.bans.push(...target.banKeys)
    return { ok: true, kicked: guestId }
  }

  private setPadType(guestId: GuestId, padType: PadType): Outcome {
    const target = this.find(guestId)
    if (!target) return UNKNOWN
    target.padType = padType
    return DONE
  }

  private chat(actor: Actor, text: string, now: number): Outcome {
    const sender = actor.kind === 'guest' ? this.find(actor.guestId) : null
    if (sender) {
      if (now - sender.lastChatAt < CHAT_INTERVAL_MS) return { ok: false, reason: 'too-fast' }
      sender.lastChatAt = now
    }
    const message: ChatMessage = {
      from: sender?.id ?? null,
      name: sender?.name ?? this.host.name,
      text: text.slice(0, MAX_CHAT_LENGTH),
      at: now,
    }
    this.snapshot.chat = [...this.snapshot.chat, message].slice(-CHAT_HISTORY)
    return { ok: true, chat: message }
  }

  /** Free seats go to the spectators in line, then to anyone watching except `skip`. */
  private fillSeats(now: number, skip?: GuestId): void {
    while (this.seatsLeft() > 0) {
      const nextId = this.snapshot.queue.shift()
      const next =
        (nextId !== undefined ? this.find(nextId) : undefined) ??
        this.snapshot.members.find((m) => m.role === 'spectator' && m.id !== skip)
      if (next?.role !== 'spectator') break
      next.role = 'player'
      next.playingSince = now
    }
  }

  private seatsLeft(): number {
    return this.settings.maxPlayers - this.seated().length
  }

  private seated(): StoredMember[] {
    return this.snapshot.members.filter((m) => m.role !== 'spectator')
  }

  private publicRefused(policy: Policy): RoomState['publicRefused'] {
    if (this.settings.visibility !== 'public') return null
    if (!policy.publicRoomsEnabled) return 'disabled'
    return this.host.userId ? null : 'sign-in-required'
  }

  private find(guestId: GuestId): StoredMember | undefined {
    return this.snapshot.members.find((m) => m.id === guestId)
  }

  private actorRole(actor: Actor): ActorRole | null {
    if (actor.kind === 'host') return 'host'
    return this.find(actor.guestId)?.role ?? null
  }
}

type ActorRole = GuestRole | 'host'

function publicMember({ banKeys, playingSince, lastChatAt, ...member }: StoredMember): Member {
  return member
}
