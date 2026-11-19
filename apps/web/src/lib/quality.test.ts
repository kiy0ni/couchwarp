import { describe, expect, it } from 'vitest'
import { lossPermille } from './quality'

describe('lossPermille', () => {
  it('counts the share lost since the last reading', () => {
    expect(lossPermille({ received: 1000, lost: 0 }, { received: 1980, lost: 20 })).toBe(20)
    expect(lossPermille({ received: 0, lost: 0 }, { received: 500, lost: 0 })).toBe(0)
  })

  it('treats counters going back as a clean second', () => {
    expect(lossPermille({ received: 900, lost: 30 }, { received: 10, lost: 0 })).toBe(0)
  })
})
