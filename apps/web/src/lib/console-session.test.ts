import { describe, expect, it } from 'vitest'
import { consoleKeyFromHash } from './console-session'

describe('consoleKeyFromHash', () => {
  it('reads the key from the link fragment', () => {
    expect(consoleKeyFromHash('#key=abc123')).toBe('abc123')
    expect(consoleKeyFromHash('')).toBeNull()
  })
})
