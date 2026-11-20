import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { cleanLogin } from '../src/auth/password'
import { SITE } from './helpers'

function post(path: string, body: unknown, cookie = '') {
  return exports.default.fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
}

const cookieOf = (response: Response) => response.headers.get('Set-Cookie')?.split(';')[0] ?? ''

describe('accounts with a password', () => {
  it('keeps logins plain', () => {
    expect(cleanLogin('  Lea@Example.com ')).toBe('lea@example.com')
    expect(cleanLogin('ab')).toBeNull()
    expect(cleanLogin('léa')).toBeNull()
  })

  it('signs up once per login, signed in at once, 13 or over only', async () => {
    const account = { login: 'lea@example.com', password: 'a long password', displayName: 'Léa' }
    expect((await post('/api/auth/password/signup', account)).status).toBe(400)
    expect(
      (await post('/api/auth/password/signup', { ...account, password: 'short', atLeast13: true }))
        .status,
    ).toBe(400)
    const created = await post('/api/auth/password/signup', { ...account, atLeast13: true })
    expect(created.status).toBe(201)
    const me = await exports.default.fetch(`${SITE}/api/me`, {
      headers: { Cookie: cookieOf(created) },
    })
    expect(await me.json()).toMatchObject({
      displayName: 'Léa',
      ageConfirmed: true,
      identities: [{ provider: 'password', username: 'lea@example.com' }],
    })
    expect((await post('/api/auth/password/signup', { ...account, atLeast13: true })).status).toBe(
      409,
    )
  })

  it('signs in with the right password, and slows down guessing', async () => {
    await post('/api/auth/password/signup', {
      login: 'sam',
      password: 'another long one',
      displayName: 'Sam',
      atLeast13: true,
    })
    const wrong = await post('/api/auth/password/login', {
      login: 'sam',
      password: 'not the password',
    })
    expect(wrong.status).toBe(401)
    const right = await post('/api/auth/password/login', {
      login: 'SAM',
      password: 'another long one',
    })
    expect(right.status).toBe(200)
    const token = await post('/api/auth/host-token', {}, cookieOf(right))
    expect(await token.json()).toHaveProperty('token')
    for (let i = 0; i < 10; i++) {
      await post('/api/auth/password/login', { login: 'sam', password: 'still not it!!' })
    }
    const locked = await post('/api/auth/password/login', {
      login: 'sam',
      password: 'another long one',
    })
    expect(locked.status).toBe(429)
  })
})
