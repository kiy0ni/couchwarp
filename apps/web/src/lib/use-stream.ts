import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { ClockSync, captureTime, LatencyWindow } from './latency'
import { type EndReason, GuestSession } from './session'

const PING_MS = 1000
const MEASURES_MS = 500

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
  const [measures, setMeasures] = useState(NO_MEASURES)
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
      onConnected: startPinging,
      onVideo(stream) {
        const element = video.current
        if (!element) return
        element.srcObject = stream
        element.play().catch((error) => console.error('Video playback refused', error))
      },
      onControl(message) {
        switch (message.type) {
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

    return () => {
      current.close()
      window.clearInterval(pinger)
      window.clearInterval(reporter)
      element?.cancelVideoFrameCallback(frameRequest)
    }
  }, [code, name, video])

  const forgetPad = useCallback((pad: number) => {
    setSlots((previous) => {
      const next = new Map(previous)
      next.delete(pad)
      return next
    })
  }, [])

  return { session, hasPicture, slots, paused, measures, forgetPad }
}
