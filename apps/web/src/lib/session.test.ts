import { encodeInput, type InputPacket } from '@couchwarp/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type EndReason, GuestSession, type SessionEvents } from './session'

/**
 * A guest joining from a plain browser, end to end on the guest's side: the room server's
 * WebSocket and the WebRTC connection are stand-ins that record what the page does and
 * answer like the real ones. Nothing here needs the desktop app.
 */

class FakeSocket {
  static readonly OPEN = 1
  static last: FakeSocket
  readyState = FakeSocket.OPEN
  readonly sent: unknown[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.last = this
  }

  send(text: string): void {
    this.sent.push(JSON.parse(text))
  }

  close(): void {
    this.readyState = 3
  }

  /** A message from the room server. */
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

class FakeChannel {
  readyState: RTCDataChannelState = 'connecting'
  bufferedAmount = 0
  readonly sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(
    readonly label: string,
    readonly options?: RTCDataChannelInit,
  ) {}

  send(data: unknown): void {
    this.sent.push(data)
  }

  open(): void {
    this.readyState = 'open'
    this.onopen?.()
  }
}

class FakePeer {
  static last: FakePeer
  readonly channels: FakeChannel[] = []
  readonly transceivers: string[] = []
  readonly candidates: RTCIceCandidateInit[] = []
  remote: RTCSessionDescriptionInit | null = null
  connectionState: RTCPeerConnectionState = 'new'
  onicecandidate:
    | ((event: { candidate: { candidate: string; sdpMid: string } | null }) => void)
    | null = null
  onconnectionstatechange: (() => void) | null = null
  ontrack: (() => void) | null = null

  constructor(readonly config: RTCConfiguration) {
    FakePeer.last = this
  }

  createDataChannel(label: string, options?: RTCDataChannelInit): FakeChannel {
    const channel = new FakeChannel(label, options)
    this.channels.push(channel)
    return channel
  }

  addTransceiver(kind: string) {
    this.transceivers.push(kind)
    return { setCodecPreferences: () => undefined }
  }

  async createOffer() {
    return { type: 'offer', sdp: 'v=0 guest offer' }
  }

  async setLocalDescription(): Promise<void> {}

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remote = description
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.candidates.push(candidate)
  }

  close(): void {
    this.connectionState = 'closed'
  }

  setState(state: RTCPeerConnectionState): void {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }

  channel(label: string): FakeChannel {
    const found = this.channels.find((channel) => channel.label === label)
    if (!found) throw new Error(`no ${label} channel`)
    return found
  }
}

class FakeStream {
  private readonly tracks: unknown[] = []
  addTrack(track: unknown): void {
    this.tracks.push(track)
  }
  getTracks(): unknown[] {
    return this.tracks
  }
}

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478'] }]

function recorder() {
  const ended: EndReason[] = []
  const events: SessionEvents = {
    onWaiting: vi.fn(),
    onWelcome: vi.fn(),
    onRoom: vi.fn(),
    onChat: vi.fn(),
    onConnected: vi.fn(),
    onMedia: vi.fn(),
    onControl: vi.fn(),
    onEnd: (reason) => ended.push(reason),
  }
  return { events, ended }
}

/** Lets the session's promises (offer, answer) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('RTCPeerConnection', FakePeer)
  vi.stubGlobal('MediaStream', FakeStream)
  vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [] }) })
  vi.stubGlobal('location', { protocol: 'https:', host: 'couchwarp.test' })
})

afterEach(() => vi.unstubAllGlobals())

describe('joining from a browser', () => {
  it('goes from the code to an open connection with the host', async () => {
    const { events, ended } = recorder()
    const session = new GuestSession('K7QM2X', 'Léa B', events)
    const socket = FakeSocket.last
    expect(socket.url).toBe('wss://couchwarp.test/api/rooms/K7QM2X/guest?name=L%C3%A9a%20B')

    socket.receive({ type: 'welcome', guestId: 3, iceServers: STUN, relayOnly: false })
    await settle()
    expect(events.onWelcome).toHaveBeenCalledWith(3)
    const peer = FakePeer.last
    expect(peer.config.iceServers).toEqual(STUN)
    expect(peer.config.iceTransportPolicy).toBe('all')
    expect(peer.transceivers).toEqual(['video', 'audio'])
    // Input is never retransmitted: a late state is worse than a lost one.
    expect(peer.channel('input').options).toEqual({ ordered: false, maxRetransmits: 0 })
    expect(socket.sent).toContainEqual({
      type: 'signal',
      payload: { kind: 'offer', sdp: 'v=0 guest offer' },
    })

    peer.onicecandidate?.({
      candidate: { candidate: 'candidate:1 1 udp 1 192.0.2.7 5000 typ host', sdpMid: '0' },
    })
    expect(socket.sent).toContainEqual({
      type: 'signal',
      payload: {
        kind: 'candidate',
        candidate: 'candidate:1 1 udp 1 192.0.2.7 5000 typ host',
        sdpMid: '0',
      },
    })

    socket.receive({ type: 'signal', payload: { kind: 'answer', sdp: 'v=0 host answer' } })
    socket.receive({
      type: 'signal',
      payload: {
        kind: 'candidate',
        candidate: 'candidate:2 1 udp 1 198.51.100.4 9 typ host',
        sdpMid: '0',
      },
    })
    await settle()
    expect(peer.remote).toEqual({ type: 'answer', sdp: 'v=0 host answer' })
    expect(peer.candidates).toHaveLength(1)

    peer.channel('control').open()
    expect(events.onConnected).toHaveBeenCalled()
    const input = peer.channel('input')
    input.open()
    const packet: InputPacket = { kind: 'keyboard', seq: 1, keys: [0x04] }
    session.sendInput(packet)
    expect(input.sent).toEqual([encodeInput(packet)])

    // Once connected, losing the room server does not end the game.
    peer.connectionState = 'connected'
    socket.onclose?.()
    expect(ended).toEqual([])
  })

  it('waits at the door without connecting until the host lets it in', () => {
    const { events } = recorder()
    new GuestSession('K7QM2X', 'Sam', events)
    FakeSocket.last.receive({ type: 'waiting' })
    expect(events.onWaiting).toHaveBeenCalledOnce()
    expect(FakeSocket.last.sent).toEqual([])
    FakeSocket.last.receive({ type: 'welcome', guestId: 4, iceServers: STUN, relayOnly: false })
    expect(events.onWelcome).toHaveBeenCalledWith(4)
  })

  it('goes through the relay only when the room asks for it', async () => {
    new GuestSession('K7QM2X', 'Sam', recorder().events)
    FakeSocket.last.receive({ type: 'welcome', guestId: 1, iceServers: STUN, relayOnly: true })
    await settle()
    expect(FakePeer.last.config.iceTransportPolicy).toBe('relay')
  })

  it('reports why the room said no', () => {
    const { events, ended } = recorder()
    new GuestSession('K7QM2X', 'Sam', events)
    FakeSocket.last.receive({ type: 'rejected', reason: 'room-full' })
    expect(ended).toEqual(['room-full'])
  })

  it('tells a blocked browser from an unreachable host', async () => {
    const blocked = recorder()
    new GuestSession('K7QM2X', 'Sam', blocked.events)
    FakeSocket.last.receive({ type: 'welcome', guestId: 1, iceServers: STUN, relayOnly: false })
    await settle()
    // Not a single local address: the browser itself refused the network.
    FakePeer.last.setState('failed')
    expect(blocked.ended).toEqual(['browser-blocked'])

    const unreachable = recorder()
    new GuestSession('K7QM2X', 'Sam', unreachable.events)
    FakeSocket.last.receive({ type: 'welcome', guestId: 2, iceServers: STUN, relayOnly: false })
    await settle()
    FakePeer.last.onicecandidate?.({
      candidate: { candidate: 'candidate:1 1 udp 1 192.0.2.7 5000 typ host', sdpMid: '0' },
    })
    FakePeer.last.setState('failed')
    expect(unreachable.ended).toEqual(['connection-failed'])
  })

  it('ends when the room server drops before the host is reached', () => {
    const { events, ended } = recorder()
    new GuestSession('K7QM2X', 'Sam', events)
    FakeSocket.last.onclose?.()
    expect(ended).toEqual(['server-unreachable'])
  })
})
