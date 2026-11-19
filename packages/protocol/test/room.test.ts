import { describe, expect, it } from 'vitest'
import { cleanText, DEFAULT_SETTINGS, parseHostCommand, parseSettings } from '../src'

describe('room settings', () => {
  it('accepts the defaults', () => {
    expect(parseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('refuses out of range values', () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, maxPlayers: 9 })).toBeNull()
    expect(parseSettings({ ...DEFAULT_SETTINGS, maxPlayers: 0 })).toBeNull()
    expect(parseSettings({ ...DEFAULT_SETTINGS, visibility: 'friends' })).toBeNull()
    expect(
      parseSettings({ ...DEFAULT_SETTINGS, hotseat: { mode: 'timer', minutes: 0 } }),
    ).toBeNull()
  })

  it('cleans and caps the title', () => {
    const settings = parseSettings({
      ...DEFAULT_SETTINGS,
      title: `  Soirée\n\u0007${'x'.repeat(80)}`,
    })
    expect(settings?.title.startsWith('Soirée x')).toBe(true)
    expect([...(settings?.title ?? '')]).toHaveLength(60)
  })
})

describe('host commands', () => {
  it('refuses unknown roles and pad types', () => {
    expect(parseHostCommand({ type: 'set-role', guestId: 1, role: 'host' })).toBeNull()
    expect(parseHostCommand({ type: 'set-pad-type', guestId: 1, padType: 'switch' })).toBeNull()
  })

  it('drops empty chat messages', () => {
    expect(parseHostCommand({ type: 'chat', text: '   \n ' })).toBeNull()
  })

  it('caps chat messages', () => {
    const command = parseHostCommand({ type: 'chat', text: 'a'.repeat(400) })
    expect(command?.type === 'chat' && command.text.length).toBe(300)
  })

  it('keeps emoji whole when cutting', () => {
    expect(cleanText('🎮🎮🎮', 2)).toBe('🎮🎮')
  })
})
