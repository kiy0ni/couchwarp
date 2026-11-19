import {
  type ChatMessage,
  type ConsoleToEdge,
  type HostCommand,
  parseEdgeToConsole,
  type RejectReason,
  type RoomState,
} from '@couchwarp/protocol'

export type ConsoleEnd = RejectReason | 'server-unreachable'

export interface ConsoleEvents {
  onRoom(state: RoomState): void
  onChat(message: ChatMessage): void
  /** Called once. The socket is closed by then. */
  onEnd(reason: ConsoleEnd): void
}

/**
 * The host console's link to the room server. It proves it belongs to the host with the
 * key from the console link, then sends the same commands as the host app.
 */
export class ConsoleSession {
  private readonly socket: WebSocket
  private ended = false

  constructor(code: string, key: string, events: ConsoleEvents) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    this.socket = new WebSocket(`${scheme}://${location.host}/api/rooms/${code}/console`)
    this.socket.onopen = () => this.send({ type: 'auth', key })
    this.socket.onmessage = (event) => {
      const message = parseEdgeToConsole(String(event.data))
      if (!message) {
        console.error('Unexpected message from the room server', event.data)
      } else if (message.type === 'room-state') {
        events.onRoom(message.state)
      } else if (message.type === 'chat') {
        events.onChat(message.message)
      } else {
        this.end(events, message.reason)
      }
    }
    this.socket.onclose = () => this.end(events, 'server-unreachable')
  }

  command(command: HostCommand): void {
    this.send(command)
  }

  close(): void {
    this.ended = true
    this.socket.close(1000)
  }

  private send(message: ConsoleToEdge): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private end(events: ConsoleEvents, reason: ConsoleEnd): void {
    if (this.ended) return
    this.close()
    events.onEnd(reason)
  }
}

/** The key sits in the link's fragment, `#key=…`, which browsers never send to a server. */
export function consoleKeyFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('key')
}
