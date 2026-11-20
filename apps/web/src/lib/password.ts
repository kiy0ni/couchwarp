import { accountRequest } from './account'
import { desktop, isDesktop } from './desktop'

/** What a password request gave: done, or the server's reason, as `t.password.errors` names it. */
export type PasswordResult = { ok: true } | { ok: false; reason: string }

/** Lengths the server accepts; checked here first so the form can say so at once. */
export const MIN_PASSWORD = 10
export const LOGIN_PATTERN = /^[A-Za-z0-9._+@-]{3,64}$/

async function result(response: Response): Promise<PasswordResult> {
  if (response.ok) return { ok: true }
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return { ok: false, reason: body.error ?? 'failed' }
}

/**
 * The desktop app hosts with a session of its own: after signing in with a password in
 * its window, it asks the site for one and keeps it, as a Discord sign-in would.
 */
async function keepForHosting(): Promise<void> {
  if (!isDesktop) return
  const response = await accountRequest('/api/auth/host-token', 'POST')
  if (!response.ok) return
  const { token } = (await response.json()) as { token: string }
  await desktop.saveSession(token)
}

export async function signUpWithPassword(fields: {
  login: string
  password: string
  displayName: string
  atLeast13: boolean
}): Promise<PasswordResult> {
  const outcome = await result(await accountRequest('/api/auth/password/signup', 'POST', fields))
  if (outcome.ok) await keepForHosting()
  return outcome
}

export async function signInWithPassword(login: string, password: string): Promise<PasswordResult> {
  const outcome = await result(
    await accountRequest('/api/auth/password/login', 'POST', { login, password }),
  )
  if (outcome.ok) await keepForHosting()
  return outcome
}

/** Adds a login and password to an account made with Discord or Google. */
export async function addPassword(login: string, password: string): Promise<PasswordResult> {
  return result(await accountRequest('/api/me/password', 'POST', { login, password }))
}
