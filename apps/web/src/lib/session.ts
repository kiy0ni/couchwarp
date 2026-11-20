import {
  type ChatMessage,
  encodeInput,
  type GuestControl,
  type GuestToEdge,
  type HostControl,
  type IceServer,
  type InputPacket,
  parseEdgeToGuest,
  parseHostControl,
  type RejectReason,
  type RoomState,
  type SignalPayload,
} from '@couchwarp/protocol'
import type { PacketCounts } from './quality'

export type EndReason =
  | RejectReason
  | 'host-left'
  | 'connection-failed'
  | 'browser-blocked'
  | 'server-unreachable'

export interface SessionEvents {
  /** The room server let us in, under this id. */
  onWelcome(guestId: number): void
  /** The whole room, after every change. */
  onRoom(state: RoomState): void
  onChat(message: ChatMessage): void
  /** The control channel is open: the host can hear us. */
  onConnected(): void
  /** Called once, with a stream that gains the sound track when it arrives. */
  onMedia(stream: MediaStream): void
  onControl(message: HostControl): void
  /** Called once. The session is closed by then. */
  onEnd(reason: EndReason): void
}

/** Above this, the input channel is backed up and a newer state is coming anyway. */
const MAX_BUFFERED_INPUT_BYTES = 16 * 1024

/**
 * One guest's connection to a room: the WebSocket to the room server, used only to
 * negotiate, then the WebRTC link to the host carrying video, input and control.
 */
export class GuestSession {
  private readonly socket: WebSocket
  private peer: RTCPeerConnection | null = null
  private input: RTCDataChannel | null = null
  private control: RTCDataChannel | null = null
  private ended = false
  private readonly media = new MediaStream()

  constructor(
    code: string,
    name: string,
    private readonly events: SessionEvents,
  ) {
    this.socket = new WebSocket(roomSocketUrl(code, name))
    this.socket.onmessage = (event) => this.onSignal(String(event.data))
    this.socket.onclose = () => {
      // Once the host is reachable over WebRTC, the room server is no longer needed.
      if (this.peer?.connectionState !== 'connected') this.end('server-unreachable')
    }
  }

  sendInput(packet: InputPacket): void {
    if (this.input?.readyState !== 'open') return
    if (this.input.bufferedAmount > MAX_BUFFERED_INPUT_BYTES) return
    this.input.send(encodeInput(packet))
  }

  /** Chat, raising a hand, and what moderators may do. Lost if the room server is gone. */
  sendRoom(message: Exclude<GuestToEdge, { type: 'signal' }>): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  /** Video packets received and lost so far, or null before the video track exists. */
  async videoPackets(): Promise<PacketCounts | null> {
    const stats = await this.peer?.getStats()
    let counts: PacketCounts | null = null
    stats?.forEach((report: RTCInboundRtpStreamStats) => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        counts = { received: report.packetsReceived ?? 0, lost: report.packetsLost ?? 0 }
      }
    })
    return counts
  }

  sendControl(message: GuestControl): void {
    if (this.control?.readyState === 'open') this.control.send(JSON.stringify(message))
  }

  close(): void {
    this.ended = true
    this.peer?.close()
    this.socket.close(1000)
  }

  private end(reason: EndReason): void {
    if (this.ended) return
    this.close()
    this.events.onEnd(reason)
  }

  private onSignal(text: string): void {
    const message = parseEdgeToGuest(text)
    if (!message) {
      console.error('Unexpected message from the room server', text)
      return
    }
    switch (message.type) {
      case 'welcome':
        this.events.onWelcome(message.guestId)
        this.connect(message.iceServers, message.relayOnly).catch((error) => this.fail(error))
        break
      case 'room-state':
        this.events.onRoom(message.state)
        break
      case 'chat':
        this.events.onChat(message.message)
        break
      case 'signal':
        this.applySignal(message.payload).catch((error) => this.fail(error))
        break
      case 'rejected':
        this.end(message.reason)
        break
      case 'host-left':
        this.end('host-left')
        break
    }
  }

  /** `relayOnly`: only relay candidates are gathered, so the host never sees our address. */
  private async connect(iceServers: IceServer[], relayOnly: boolean): Promise<void> {
    const peer = new RTCPeerConnection({
      iceServers,
      bundlePolicy: 'max-bundle',
      iceTransportPolicy: relayOnly ? 'relay' : 'all',
    })
    this.peer = peer

    this.control = peer.createDataChannel('control')
    this.control.onopen = () => this.events.onConnected()
    this.control.onmessage = (event) => {
      const message = parseHostControl(String(event.data))
      if (message) this.events.onControl(message)
    }
    // Unordered and never retransmitted: a late input state is worse than a lost one.
    this.input = peer.createDataChannel('input', { ordered: false, maxRetransmits: 0 })

    const transceiver = peer.addTransceiver('video', { direction: 'recvonly' })
    preferBaselineH264(transceiver)
    peer.addTransceiver('audio', { direction: 'recvonly' })

    peer.ontrack = (event) => {
      // Play frames and sound as soon as they are decoded instead of buffering for smoothness.
      event.receiver.jitterBufferTarget = 0
      this.media.addTrack(event.track)
      if (this.media.getTracks().length === 1) this.events.onMedia(this.media)
    }
    // No candidate at all means the browser itself has no network path for WebRTC
    // (blocked by a privacy setting or the system), not that the host is unreachable.
    let candidates = 0
    peer.onicecandidate = (event) => {
      if (event.candidate?.candidate) {
        candidates++
        this.sendSignal({
          kind: 'candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
        })
      }
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') {
        this.end(candidates === 0 ? 'browser-blocked' : 'connection-failed')
      }
    }

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    this.sendSignal({ kind: 'offer', sdp: offer.sdp ?? '' })
  }

  private async applySignal(payload: SignalPayload): Promise<void> {
    if (!this.peer) return
    if (payload.kind === 'answer') {
      await this.peer.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
    } else if (payload.kind === 'candidate') {
      await this.peer.addIceCandidate({ candidate: payload.candidate, sdpMid: payload.sdpMid })
    }
  }

  private sendSignal(payload: SignalPayload): void {
    this.socket.send(JSON.stringify({ type: 'signal', payload } satisfies GuestToEdge))
  }

  private fail(error: unknown): void {
    console.error('WebRTC negotiation failed', error)
    this.end('connection-failed')
  }
}

function roomSocketUrl(code: string, name: string): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/rooms/${code}/guest?name=${encodeURIComponent(name)}`
}

/**
 * Offers only constrained baseline H.264, the profile the host encodes and every browser
 * decodes in hardware. Retransmission codecs (RTX) are kept for lost packets.
 */
function preferBaselineH264(transceiver: RTCRtpTransceiver): void {
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? []
  const baseline = codecs.filter(
    (codec) =>
      codec.mimeType === 'video/H264' &&
      /packetization-mode=1/.test(codec.sdpFmtpLine ?? '') &&
      /profile-level-id=42e0/i.test(codec.sdpFmtpLine ?? ''),
  )
  if (baseline.length === 0) return
  const retransmission = codecs.filter((codec) => codec.mimeType === 'video/rtx')
  transceiver.setCodecPreferences([...baseline, ...retransmission])
}

/** What the code alone shows of an open room, before joining it. */
export interface RoomPreview {
  title: string
  game: string
  hostName: string
  players: number
  maxPlayers: number
  spectators: number
  /** For a known game: its tall cover and wide picture. */
  cover: string | null
  header: string | null
}

/** The room behind `code`, or null when no host has it open. */
export async function lookUpRoom(code: string): Promise<RoomPreview | null> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`)
  if (!response.ok) throw new Error(`Room check failed with HTTP ${response.status}`)
  const info = (await response.json()) as { open: boolean; room?: RoomPreview }
  return info.open && info.room ? info.room : null
}

/** Whether the room server knows an open room with this code. */
export async function isRoomOpen(code: string): Promise<boolean> {
  return (await lookUpRoom(code)) !== null
}
