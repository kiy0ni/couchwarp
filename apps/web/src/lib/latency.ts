/**
 * Glass-to-glass latency: from the moment the host captured a frame to the moment this
 * screen shows it.
 *
 * The host tells us the Unix time of RTP timestamp 0 (`stream-clock`). Each frame's RTP
 * timestamp then gives its capture time on the host clock. A ping/pong on the control
 * channel gives the offset between the two clocks.
 */

const RTP_CLOCK_KHZ = 90
const RTP_WRAP = 2 ** 32
const CLOCK_SAMPLES = 10

/** Offset between the host clock and ours, from the fastest of the recent ping/pong rounds. */
export class ClockSync {
  private samples: { roundTrip: number; offset: number }[] = []

  /** `t0` sent and `t3` received on our clock, `t1` answered on the host's. All in ms. */
  add(t0: number, t1: number, t3: number): void {
    this.samples.push({ roundTrip: t3 - t0, offset: t1 - (t0 + t3) / 2 })
    if (this.samples.length > CLOCK_SAMPLES) this.samples.shift()
  }

  /** Host time minus our time, in ms. Null before the first pong. */
  get offset(): number | null {
    let best: { roundTrip: number; offset: number } | null = null
    for (const sample of this.samples) {
      if (!best || sample.roundTrip < best.roundTrip) best = sample
    }
    return best?.offset ?? null
  }

  get roundTrip(): number | null {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.roundTrip)) : null
  }
}

/**
 * Host capture time of a frame, in Unix ms. `rtpTimestamp` is the 32-bit value from the
 * packet; `hostNow` is a rough current host time, used to pick the right wrap-around.
 */
export function captureTime(rtpTimestamp: number, epochMs: number, hostNow: number): number {
  const expectedTicks = (hostNow - epochMs) * RTP_CLOCK_KHZ
  const wraps = Math.round((expectedTicks - rtpTimestamp) / RTP_WRAP)
  return epochMs + (rtpTimestamp + wraps * RTP_WRAP) / RTP_CLOCK_KHZ
}

export interface LatencyStats {
  median: number
  p95: number
  frames: number
}

/** Latency samples over a sliding window. */
export class LatencyWindow {
  private samples: { at: number; ms: number }[] = []

  constructor(private readonly windowMs = 5000) {}

  add(ms: number, at: number): void {
    this.samples.push({ at, ms })
    while (this.samples[0] && this.samples[0].at < at - this.windowMs) this.samples.shift()
  }

  stats(): LatencyStats | null {
    if (this.samples.length === 0) return null
    const sorted = this.samples.map((s) => s.ms).sort((a, b) => a - b)
    const at = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
    return { median: at(0.5), p95: at(0.95), frames: sorted.length }
  }
}

export type LatencyQuality = 'good' | 'fair' | 'poor'

/**
 * How a picture latency feels in play: under 60 ms most players notice nothing, past
 * 110 ms fast games suffer.
 */
export function latencyQuality(ms: number): LatencyQuality {
  if (ms < 60) return 'good'
  return ms < 110 ? 'fair' : 'poor'
}
