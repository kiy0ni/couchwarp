import type { ChatMessage, Member, RoomState } from '@couchwarp/protocol'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { ClockSync, captureTime, LatencyWindow } from './latency'
import { lossPermille, type PacketCounts } from './quality'
import { type EndReason, GuestSession } from './session'

const PING_MS = 1000
const MEASURES_MS = 500
/** How often the host hears how the stream arrives, to adapt its bitrate. */
const QUALITY_MS = 1000
/** Messages kept on screen; the room server keeps its own history for newcomers. */
const CHAT_KEPT = 100

export interface Measures {
  /** Glass-to-glass latency over the last seconds, in ms. Null until measured. */
  median: number | null
  p95: number | null
  roundTrip: number | null
  fps: number
  width: number
  height: number
  /** False when the browser does not give frame RTP timestamps (picture latency unknown). */
  captureTimeKnown: boolean
}

const NO_MEASURES: Measures = {
  median: null,
  p95: null,
  roundTrip: null,
  fps: 0,
  width: 0,
  height: 0,
  captureTimeKnown: true,
}

function unixNow(): number {
  return performance.timeOrigin + performance.now()
}

/**
 * Runs one guest session for the lifetime of the component: connects, shows the video in
 * `video`, follows what the host says, and measures latency on every frame.
 */
export function useStream(
  code: string,
  name: string,
  video: RefObject<HTMLVideoElement | null>,
  onEnd: (reason: EndReason) => void,
) {
  const [session, setSession] = useState<GuestSession | null>(null)
  const [hasPicture, setHasPicture] = useState(false)
  const [slots, setSlots] = useState<ReadonlyMap<number, number>>(new Map())
  const [paused, setPaused] = useState(false)
  /** The browser refused to start the sound without a click; the picture plays muted. */
  const [soundBlocked, setSoundBlocked] = useState(false)
  /** Whether controllers reach the game. Unknown (null) until the host says. */
  const [virtualPads, setVirtualPads] = useState<boolean | null>(null)
  const [measures, setMeasures] = useState(NO_MEASURES)
  const [guestId, setGuestId] = useState<number | null>(null)
  /** At the door, until the host lets this guest in. */
  const [waiting, setWaiting] = useState(false)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const onEndRef = useRef(onEnd)
  useEffect(() => {
    onEndRef.current = onEnd
  }, [onEnd])

  useEffect(() => {
    const clock = new ClockSync()
    const latency = new LatencyWindow()
    const frameTimes: number[] = []
    let epochMs: number | null = null
    let captureTimeKnown = true
    let pinger = 0

    const current = new GuestSession(code, name, {
      onWaiting: () => setWaiting(true),
      onWelcome: (id) => {
        setWaiting(false)
        setGuestId(id)
      },
      onRoom: setRoom,
      onChat: (message) => setChat((previous) => [...previous, message].slice(-CHAT_KEPT)),
      onConnected: startPinging,
      onMedia(stream) {
        const element = video.current
        if (!element) return
        element.srcObject = stream
        element.muted = false
        element.play().catch(() => {
          // Autoplay rules allow a muted start; the guest turns sound on with one click.
          element.muted = true
          setSoundBlocked(true)
          element.play().catch((error) => console.error('Video playback refused', error))
        })
      },
      onControl(message) {
        switch (message.type) {
          case 'host-info':
            setVirtualPads(message.virtualPads)
            break
          case 'pong':
            clock.add(message.t0, message.t1, unixNow())
            break
          case 'stream-clock':
            epochMs = message.epochMs
            break
          case 'slot':
            setSlots((previous) => new Map(previous).set(message.pad, message.slot))
            break
          case 'input-paused':
            setPaused(message.paused)
            break
        }
      },
      onEnd: (reason) => onEndRef.current(reason),
    })
    setSession(current)

    function startPinging() {
      ping()
      pinger = window.setInterval(ping, PING_MS)
    }
    function ping() {
      current.sendControl({ type: 'ping', t0: unixNow() })
    }

    let frameRequest = 0
    const element = video.current
    const onFrame: VideoFrameRequestCallback = (now, frame) => {
      setHasPicture(true)
      frameTimes.push(now)
      while (frameTimes[0] !== undefined && frameTimes[0] < now - 1000) frameTimes.shift()
      const offset = clock.offset
      if (frame.rtpTimestamp === undefined) {
        captureTimeKnown = false
      } else if (epochMs !== null && offset !== null) {
        const shownAt = performance.timeOrigin + frame.expectedDisplayTime
        const hostShownAt = shownAt + offset
        latency.add(hostShownAt - captureTime(frame.rtpTimestamp, epochMs, hostShownAt), shownAt)
      }
      frameRequest = element?.requestVideoFrameCallback(onFrame) ?? 0
    }
    frameRequest = element?.requestVideoFrameCallback(onFrame) ?? 0

    const reporter = window.setInterval(() => {
      const stats = latency.stats()
      setMeasures({
        median: stats?.median ?? null,
        p95: stats?.p95 ?? null,
        roundTrip: clock.roundTrip,
        fps: frameTimes.length,
        width: element?.videoWidth ?? 0,
        height: element?.videoHeight ?? 0,
        captureTimeKnown,
      })
    }, MEASURES_MS)

    let lastPackets: PacketCounts | null = null
    const qualityReporter = window.setInterval(async () => {
      const packets = await current.videoPackets()
      if (!packets) return
      if (lastPackets) {
        const p95 = latency.stats()?.p95
        current.sendControl({
          type: 'quality',
          lossPermille: lossPermille(lastPackets, packets),
          latencyMs: p95 === undefined ? null : Math.round(p95),
        })
      }
      lastPackets = packets
    }, QUALITY_MS)

    return () => {
      current.close()
      window.clearInterval(pinger)
      window.clearInterval(reporter)
      window.clearInterval(qualityReporter)
      element?.cancelVideoFrameCallback(frameRequest)
    }
  }, [code, name, video])

  const enableSound = useCallback(() => {
    const element = video.current
    if (!element) return
    element.muted = false
    element
      .play()
      .then(() => setSoundBlocked(false))
      .catch((error) => console.error('Sound still refused', error))
  }, [video])

  const forgetPad = useCallback((pad: number) => {
    setSlots((previous) => {
      const next = new Map(previous)
      next.delete(pad)
      return next
    })
  }, [])

  const me: Member | null = room?.members.find((member) => member.id === guestId) ?? null

  return {
    session,
    room,
    me,
    chat,
    hasPicture,
    waiting,
    slots,
    paused,
    virtualPads,
    soundBlocked,
    enableSound,
    measures,
    forgetPad,
  }
}
