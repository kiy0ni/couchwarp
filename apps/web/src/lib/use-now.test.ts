import { describe, expect, it } from 'vitest'
import { countdown } from './use-now'

describe('countdown', () => {
  it('shows minutes and padded seconds, rounding up', () => {
    expect(countdown(125_000)).toBe('2:05')
    expect(countdown(59_001)).toBe('1:00')
    expect(countdown(-3000)).toBe('0:00')
  })
})
