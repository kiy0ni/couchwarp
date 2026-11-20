import { describe, expect, it } from 'vitest'
import { handleOf, MAX_REPORT_DETAILS, parseReportRequest } from '../src/community'

describe('parseReportRequest', () => {
  it('accepts a report about a guest or the room', () => {
    expect(
      parseReportRequest({ guestId: 3, reason: 'hate', details: 'Insultes\nrépétées' }),
    ).toEqual({
      guestId: 3,
      reason: 'hate',
      details: 'Insultes répétées',
    })
    expect(
      parseReportRequest({ guestId: null, reason: 'illegal-game', details: '' }),
    ).toMatchObject({
      guestId: null,
    })
  })

  it('caps the details and refuses unknown reasons', () => {
    const long = parseReportRequest({ guestId: null, reason: 'other', details: 'x'.repeat(900) })
    expect(long?.details).toHaveLength(MAX_REPORT_DETAILS)
    expect(parseReportRequest({ guestId: null, reason: 'boring', details: '' })).toBeNull()
    expect(parseReportRequest({ guestId: 0, reason: 'other', details: '' })).toBeNull()
  })
})

describe('handleOf', () => {
  it('keeps letters, digits and a few signs, so a tag can be typed anywhere', () => {
    expect(handleOf('KiyOni 🍥')).toBe('KiyOni')
    expect(handleOf('Léa la rapide')).toBe('Lealarapide')
    expect(handleOf('x_y.z-1')).toBe('x_y.z-1')
    expect(handleOf('🍥🍥')).toBe('joueur')
  })
})
