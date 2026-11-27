import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { cleanDisplayName, imageType } from '../src/profiles'
import { SITE, signIn } from './helpers'

function api(path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return exports.default.fetch(`${SITE}${path}`, { ...init, headers })
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])

describe('profiles', () => {
  it('cleans names and recognises pictures by their bytes', () => {
    expect(cleanDisplayName('  Léa \u0007  la   rapide ')).toBe('Léa la rapide')
    expect(cleanDisplayName('a')).toBeNull()
    expect(cleanDisplayName('x'.repeat(33))).toBeNull()
    expect(imageType(PNG)).toBe('image/png')
    expect(imageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
  })

  it('changes the name and colour, and shows them publicly with the badges', async () => {
    const lea = await signIn('lea-p', 'Léa')
    const patch = (body: unknown) =>
      api('/api/me/profile', lea, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      })
    expect((await patch({ color: 'purple' })).status).toBe(400)
    expect((await patch({ displayName: ' ' })).status).toBe(400)
    expect((await patch({ displayName: 'Léa la rapide', color: 'sky' })).status).toBe(200)
    const profile = await (await api('/api/users/lea-p', null)).json()
    expect(profile).toMatchObject({ displayName: 'Léa la rapide', color: 'sky' })
    expect(profile).toHaveProperty('badges')
  })

  it('keeps the host badge alongside the regular host one', async () => {
    await signIn('max-p', 'Max')
    const host = (code: string) =>
      env.DB.prepare(
        `INSERT INTO play_history (user_id, room_code, title, game, host_name, joined_at, hosted)
         VALUES ('max-p', ?, 'Soirée', 'Jeu', 'Max', ?, 1)`,
      ).bind(code, Date.now())
    const earned = async () =>
      (await (await api('/api/users/max-p', null)).json<{ badges: string[] }>()).badges
    await host('ROOM0').run()
    expect(await earned()).toContain('host')
    expect(await earned()).not.toContain('regular-host')
    await env.DB.batch(Array.from({ length: 9 }, (_, i) => host(`ROOM${i + 1}`)))
    expect(await earned()).toEqual(expect.arrayContaining(['host', 'regular-host']))
    // Games from more than a year ago no longer make a regular host.
    await env.DB.prepare("UPDATE play_history SET joined_at = ? WHERE user_id = 'max-p'")
      .bind(Date.now() - 400 * 24 * 60 * 60 * 1000)
      .run()
    expect(await earned()).toContain('host')
    expect(await earned()).not.toContain('regular-host')
  })

  it('keeps a picture of its own, served with its real type, and removes it', async () => {
    const sam = await signIn('sam-p', 'Sam')
    const refused = await api('/api/me/avatar', sam, {
      method: 'PUT',
      body: new TextEncoder().encode('<html></html>'),
    })
    expect(refused.status).toBe(415)
    const saved = await api('/api/me/avatar', sam, { method: 'PUT', body: PNG })
    const { avatarUrl } = await saved.json<{ avatarUrl: string }>()
    expect(avatarUrl).toMatch(/^\/api\/users\/sam-p\/avatar\?v=/)
    const picture = await api(avatarUrl, null)
    expect(picture.headers.get('Content-Type')).toBe('image/png')
    expect(picture.headers.get('X-Content-Type-Options')).toBe('nosniff')
    await api('/api/me/avatar', sam, { method: 'DELETE' })
    expect((await api('/api/users/sam-p/avatar', null)).status).toBe(404)
  })
})
