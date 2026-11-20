import { describe, expect, it } from 'vitest'
import { iceServersFor, relayConfigured, sharedSecretServer } from '../src/ice'

describe('relay credentials', () => {
  it('signs a user name that expires, as coturn checks it', async () => {
    const now = Date.UTC(2026, 10, 20)
    const server = await sharedSecretServer('turn:a.test:3478, turns:a.test:5349', 'secret', now)
    expect(server.urls).toEqual(['turn:a.test:3478', 'turns:a.test:5349'])
    const [expiry] = (server.username ?? '').split(':')
    expect(Number(expiry)).toBe(now / 1000 + 12 * 60 * 60)
    // HMAC-SHA1 of the user name with the secret, in base64: 28 characters.
    expect(server.credential).toMatch(/^[A-Za-z0-9+/]{27}=$/)
    const again = await sharedSecretServer('turn:a.test:3478', 'secret', now)
    expect(again.credential).toBe(server.credential)
    const other = await sharedSecretServer('turn:a.test:3478', 'other', now)
    expect(other.credential).not.toBe(server.credential)
  })

  it('offers a relay only when one is configured', async () => {
    const none = {} as Env
    expect(relayConfigured(none)).toBe(false)
    expect(await iceServersFor(none)).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }])
    const own = { TURN_URLS: 'turn:a.test:3478', TURN_SECRET: 's' } as Env
    expect(relayConfigured(own)).toBe(true)
    const servers = await iceServersFor(own)
    expect(servers.some((server) => server.urls.some((url) => url.startsWith('turn:')))).toBe(true)
  })
})
