import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanEmail, cleanLogin } from '../src/auth/password'
import { SITE } from './helpers'

function post(path: string, body: unknown, cookie = '', address = '203.0.113.1') {
  return exports.default.fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': address,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

function me(cookie: string) {
  return exports.default
    .fetch(`${SITE}/api/me`, { headers: { Cookie: cookie } })
    .then((response) => (response.ok ? response.json<Record<string, unknown>>() : null))
}

const cookieOf = (response: Response) => response.headers.get('Set-Cookie')?.split(';')[0] ?? ''

/** Without a mail service, links go to the log: the test reads them there. */
function mailbox() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  return {
    lastLink(page: string): string {
      const lines = log.mock.calls.map((call) => String(call[0]))
      const line = lines.reverse().find((text) => text.includes(`/${page}#token=`))
      const token = line?.match(/#token=([\w-]+)/)?.[1]
      if (!token) throw new Error(`no ${page} link in the log`)
      return token
    },
  }
}

afterEach(() => vi.restoreAllMocks())

let addressCount = 0
/** A fresh network per account, so the per-network limits do not mix tests up. */
const freshAddress = () => `198.51.100.${++addressCount}`

async function signUp(email: string, password = 'a long password') {
  const created = await post(
    '/api/auth/password/signup',
    { email, password, displayName: 'Léa', atLeast13: true },
    '',
    freshAddress(),
  )
  expect(created.status).toBe(201)
  return cookieOf(created)
}

describe('accounts with a password', () => {
  it('keeps addresses and logins plain', () => {
    expect(cleanEmail('  Lea@Example.com ')).toBe('lea@example.com')
    expect(cleanEmail('lea@example')).toBeNull()
    expect(cleanEmail('lea example@test.fr')).toBeNull()
    expect(cleanLogin('Sam')).toBe('sam')
    expect(cleanLogin('ab')).toBeNull()
  })

  it('signs up once per address, signed in at once, 13 or over only', async () => {
    const account = { email: 'lea@example.com', password: 'a long password', displayName: 'Léa' }
    expect((await post('/api/auth/password/signup', account)).status).toBe(400)
    expect(
      (
        await post('/api/auth/password/signup', {
          ...account,
          email: 'not an address',
          atLeast13: true,
        })
      ).status,
    ).toBe(400)
    const created = await post('/api/auth/password/signup', { ...account, atLeast13: true })
    expect(created.status).toBe(201)
    expect(await me(cookieOf(created))).toMatchObject({
      displayName: 'Léa',
      ageConfirmed: true,
      email: 'lea@example.com',
      emailVerified: false,
      hasPassword: true,
      identities: [{ provider: 'password', username: 'lea@example.com' }],
    })
    const again = await post('/api/auth/password/signup', { ...account, atLeast13: true })
    expect(again.status).toBe(409)
  })

  it('confirms the address from the link, once', async () => {
    const mail = mailbox()
    const cookie = await signUp('confirm@example.com')
    const token = mail.lastLink('confirm-email')
    expect((await post('/api/auth/email/confirm', { token })).status).toBe(200)
    expect(await me(cookie)).toMatchObject({ emailVerified: true })
    expect((await post('/api/auth/email/confirm', { token })).status).toBe(400)
  })

  it('resets a forgotten password and signs out every other device', async () => {
    const mail = mailbox()
    const old = await signUp('forgot@example.com')
    const unknown = await post('/api/auth/password/forgot', { email: 'nobody@example.com' })
    const known = await post('/api/auth/password/forgot', { email: 'forgot@example.com' })
    // The same answer either way: the form says nothing about who has an account.
    expect([unknown.status, known.status]).toEqual([202, 202])
    const token = mail.lastLink('reset-password')
    const reset = await post('/api/auth/password/reset', { token, password: 'a brand new one' })
    expect(reset.status).toBe(200)
    expect(await me(old)).toBeNull()
    expect(await me(cookieOf(reset))).toMatchObject({ emailVerified: true })
    const login = await post('/api/auth/password/login', {
      login: 'forgot@example.com',
      password: 'a brand new one',
    })
    expect(login.status).toBe(200)
    expect(
      (await post('/api/auth/password/reset', { token, password: 'again again' })).status,
    ).toBe(400)
  })

  it('changes the password only with the current one', async () => {
    const cookie = await signUp('change@example.com')
    const wrong = await post(
      '/api/me/password/change',
      { current: 'not the password', password: 'a fresh password' },
      cookie,
    )
    expect(wrong.status).toBe(403)
    const right = await post(
      '/api/me/password/change',
      { current: 'a long password', password: 'a fresh password' },
      cookie,
    )
    expect(right.status).toBe(200)
    expect(await me(cookie)).not.toBeNull()
  })

  it('moves to a new address once it is confirmed', async () => {
    const mail = mailbox()
    const cookie = await signUp('before@example.com')
    const refused = await post(
      '/api/me/email',
      { email: 'after@example.com', password: 'wrong password' },
      cookie,
    )
    expect(refused.status).toBe(403)
    const asked = await post(
      '/api/me/email',
      { email: 'after@example.com', password: 'a long password' },
      cookie,
    )
    expect(asked.status).toBe(202)
    expect(await me(cookie)).toMatchObject({ email: 'before@example.com' })
    const token = mail.lastLink('confirm-email')
    expect((await post('/api/auth/email/confirm', { token })).status).toBe(200)
    expect(await me(cookie)).toMatchObject({ email: 'after@example.com', emailVerified: true })
    const login = await post('/api/auth/password/login', {
      login: 'after@example.com',
      password: 'a long password',
    })
    expect(login.status).toBe(200)
  })

  it('signs in with the right password, and slows down guessing', async () => {
    await signUp('sam@example.com', 'another long one')
    const wrong = await post('/api/auth/password/login', {
      login: 'sam@example.com',
      password: 'not the password',
    })
    expect(wrong.status).toBe(401)
    const right = await post('/api/auth/password/login', {
      login: 'SAM@example.com',
      password: 'another long one',
    })
    expect(right.status).toBe(200)
    const token = await post('/api/auth/host-token', {}, cookieOf(right))
    expect(await token.json()).toHaveProperty('token')
    for (let i = 0; i < 10; i++) {
      await post('/api/auth/password/login', {
        login: 'sam@example.com',
        password: 'still not it!!',
      })
    }
    const locked = await post('/api/auth/password/login', {
      login: 'sam@example.com',
      password: 'another long one',
    })
    expect(locked.status).toBe(429)
  })

  it('limits sign-ups from one network', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const response = await post(
        '/api/auth/password/signup',
        {
          email: `many${i}@example.com`,
          password: 'a long password',
          displayName: 'Bot',
          atLeast13: true,
        },
        '',
        '192.0.2.99',
      )
      statuses.push(response.status)
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
  })
})
