import { describe, expect, it } from 'vitest'
import { currentAddress } from './router'

describe('addresses of earlier versions', () => {
  it('lead to the same pages under their English names', () => {
    expect(currentAddress('/parametres')).toBe('/settings')
    expect(currentAddress('/parametres/manettes')).toBe('/settings/controllers')
    expect(currentAddress('/compte')).toBe('/settings/account')
    expect(currentAddress('/heberger')).toBe('/host')
    expect(currentAddress('/confidentialite')).toBe('/privacy')
    expect(currentAddress('/profil/u-42')).toBe('/profile/u-42')
    expect(currentAddress('/bulle')).toBe('/bubble')
  })

  it('leave current addresses and room codes alone', () => {
    expect(currentAddress('/settings/account')).toBe('/settings/account')
    expect(currentAddress('/ABCD12')).toBe('/ABCD12')
    expect(currentAddress('/')).toBe('/')
  })
})
