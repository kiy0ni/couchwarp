import { lang } from '../i18n'
import { accountRequest } from './account'
import { desktop, isDesktop } from './desktop'

/** What an account request gave: done, or the server's reason, as `t.password.errors` names it. */
export type PasswordResult = { ok: true } | { ok: false; reason: string }

/** Lengths the server accepts; checked here first so the form can say so at once. */
export const MIN_PASSWORD = 10
export const EMAIL_PATTERN = /^[^\s@"<>()[\],;:]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

async function result(response: Response): Promise<PasswordResult> {
  if (response.ok) return { ok: true }
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return { ok: false, reason: body.error ?? 'failed' }
}

/** Mails go out in the language the person reads the site in. */
function send(path: string, body: Record<string, unknown>): Promise<PasswordResult> {
  return accountRequest(path, 'POST', { ...body, lang })
    .then(result)
    .catch(() => ({ ok: false, reason: 'failed' }))
}

/**
 * The desktop app hosts with a session of its own: after signing in with a password in
 * its window, it asks the site for one and keeps it, as a Discord sign-in would.
 */
async function keepForHosting(outcome: PasswordResult): Promise<PasswordResult> {
  if (!outcome.ok || !isDesktop) return outcome
  const response = await accountRequest('/api/auth/host-token', 'POST')
  if (response.ok) {
    const { token } = (await response.json()) as { token: string }
    await desktop.saveSession(token)
  }
  return outcome
}

export async function signUpWithPassword(fields: {
  email: string
  password: string
  displayName: string
  atLeast13: boolean
}): Promise<PasswordResult> {
  return keepForHosting(await send('/api/auth/password/signup', fields))
}

/** `login` is the address, or the login name of an account made before addresses. */
export async function signInWithPassword(login: string, password: string): Promise<PasswordResult> {
  return keepForHosting(await send('/api/auth/password/login', { login, password }))
}

/** Sends a reset link if an account has this address; answers the same either way. */
export function askPasswordReset(email: string): Promise<PasswordResult> {
  return send('/api/auth/password/forgot', { email })
}

export async function resetPassword(token: string, password: string): Promise<PasswordResult> {
  return keepForHosting(await send('/api/auth/password/reset', { token, password }))
}

export function confirmEmail(token: string): Promise<PasswordResult> {
  return send('/api/auth/email/confirm', { token })
}

/** Adds a password to an account made with Discord or Google, with an address if it has none. */
export function addPassword(email: string, password: string): Promise<PasswordResult> {
  return send('/api/me/password', { email, password })
}

export function changePassword(current: string, password: string): Promise<PasswordResult> {
  return send('/api/me/password/change', { current, password })
}

/** Sends a link to the new address; the account moves to it once confirmed. */
export function changeEmail(email: string, password: string): Promise<PasswordResult> {
  return send('/api/me/email', { email, password })
}

export function resendConfirmation(): Promise<PasswordResult> {
  return send('/api/me/email/resend', {})
}

/** The token a link from an e-mail carries, in the address's fragment. */
export function linkToken(): string | null {
  return new URLSearchParams(location.hash.slice(1)).get('token')
}
