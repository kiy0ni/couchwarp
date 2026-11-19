import { describe, expect, it } from 'vitest'
import { ClockSync, captureTime, LatencyWindow, latencyQuality } from './latency'

describe('ClockSync', () => {
  it('estimates the offset from the fastest round trip', () => {
    const clock = new ClockSync()
    // Host runs 1000 ms ahead. A slow round trip skews the estimate, a fast one does not.
    clock.add(0, 1080, 100) // 100 ms round trip, answered late: offset 1030
    clock.add(200, 1205, 210) // 10 ms round trip: offset 1000
    expect(clock.offset).toBe(1000)
    expect(clock.roundTrip).toBe(10)
  })

  it('has no offset before the first pong', () => {
    expect(new ClockSync().offset).toBeNull()
  })
})

describe('captureTime', () => {
  const epoch = 1_763_540_000_000

  it('turns 90 kHz ticks into milliseconds after the epoch', () => {
    expect(captureTime(90_000, epoch, epoch + 1000)).toBe(epoch + 1000)
  })

  it('follows the RTP timestamp past its 32-bit wrap', () => {
    // 2^32 ticks at 90 kHz is about 13 h 15 min.
    const wrapMs = 2 ** 32 / 90
    const elapsed = wrapMs + 500
    const rtp = Math.round(elapsed * 90) % 2 ** 32
    expect(captureTime(rtp, epoch, epoch + elapsed + 30)).toBeCloseTo(epoch + elapsed, 3)
  })
})

describe('LatencyWindow', () => {
  it('reports the median and 95th percentile of recent frames', () => {
    const window = new LatencyWindow(1000)
    for (let i = 1; i <= 100; i++) window.add(i, 5000 + i)
    expect(window.stats()).toEqual({ median: 51, p95: 96, frames: 100 })
  })

  it('forgets frames older than the window', () => {
    const window = new LatencyWindow(1000)
    window.add(500, 0)
    window.add(20, 2000)
    expect(window.stats()).toEqual({ median: 20, p95: 20, frames: 1 })
  })
})

describe('latencyQuality', () => {
  it('grades the picture latency', () => {
    expect(latencyQuality(28)).toBe('good')
    expect(latencyQuality(60)).toBe('fair')
    expect(latencyQuality(140)).toBe('poor')
  })
})
