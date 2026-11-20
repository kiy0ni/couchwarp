/**
 * E-mails sent by Couchwarp: confirming an address, resetting a password, warning about
 * a change. Sent through Resend's HTTP API when `RESEND_API_KEY` and `MAIL_FROM` are set;
 * without them (local development), the message is written to the log instead.
 */

export type MailKind = 'verify' | 'change' | 'reset' | 'password-changed' | 'email-changed'
export type MailLanguage = 'fr' | 'en'

interface Mail {
  subject: string
  lines: string[]
  action?: string
}

const TEXTS: Record<MailLanguage, Record<MailKind, Mail>> = {
  fr: {
    verify: {
      subject: 'Confirme ton adresse Couchwarp',
      lines: [
        'Bienvenue sur Couchwarp.',
        'Confirme ton adresse e-mail avec le bouton ci-dessous. Le lien marche 48 heures.',
        'Si tu n’as pas créé de compte, ignore ce message.',
      ],
      action: 'Confirmer mon adresse',
    },
    change: {
      subject: 'Confirme ta nouvelle adresse Couchwarp',
      lines: [
        'Tu as demandé à changer l’adresse e-mail de ton compte Couchwarp pour celle-ci.',
        'Confirme avec le bouton ci-dessous. Le lien marche 24 heures.',
        'Si ce n’est pas toi, ignore ce message : rien ne change.',
      ],
      action: 'Confirmer cette adresse',
    },
    reset: {
      subject: 'Choisis un nouveau mot de passe Couchwarp',
      lines: [
        'Quelqu’un a demandé un nouveau mot de passe pour ton compte Couchwarp.',
        'Si c’est toi, choisis-le avec le bouton ci-dessous. Le lien marche une heure.',
        'Si ce n’est pas toi, ignore ce message : ton mot de passe ne change pas.',
      ],
      action: 'Choisir un mot de passe',
    },
    'password-changed': {
      subject: 'Ton mot de passe Couchwarp a changé',
      lines: [
        'Le mot de passe de ton compte Couchwarp vient de changer, et les autres appareils sont déconnectés.',
        'Si ce n’est pas toi, utilise « Mot de passe oublié » sur la page de connexion tout de suite.',
      ],
    },
    'email-changed': {
      subject: 'L’adresse de ton compte Couchwarp a changé',
      lines: [
        'Ton compte Couchwarp utilise désormais une autre adresse e-mail, et ne t’écrira plus ici.',
        'Si ce n’est pas toi, réponds à ce message pour qu’on t’aide.',
      ],
    },
  },
  en: {
    verify: {
      subject: 'Confirm your Couchwarp address',
      lines: [
        'Welcome to Couchwarp.',
        'Confirm your e-mail address with the button below. The link works for 48 hours.',
        'If you did not create an account, ignore this message.',
      ],
      action: 'Confirm my address',
    },
    change: {
      subject: 'Confirm your new Couchwarp address',
      lines: [
        'You asked to change your Couchwarp account’s e-mail address to this one.',
        'Confirm with the button below. The link works for 24 hours.',
        'If it was not you, ignore this message: nothing changes.',
      ],
      action: 'Confirm this address',
    },
    reset: {
      subject: 'Choose a new Couchwarp password',
      lines: [
        'Someone asked for a new password for your Couchwarp account.',
        'If it was you, choose it with the button below. The link works for one hour.',
        'If it was not you, ignore this message: your password stays the same.',
      ],
      action: 'Choose a password',
    },
    'password-changed': {
      subject: 'Your Couchwarp password changed',
      lines: [
        'Your Couchwarp account’s password just changed, and your other devices are signed out.',
        'If it was not you, use “Forgot password” on the sign-in page right away.',
      ],
    },
    'email-changed': {
      subject: 'Your Couchwarp account’s address changed',
      lines: [
        'Your Couchwarp account now uses another e-mail address, and will not write here again.',
        'If it was not you, reply to this message so we can help.',
      ],
    },
  },
}

export function mailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM)
}

export function mailLanguage(value: unknown): MailLanguage {
  return value === 'fr' ? 'fr' : 'en'
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** The message, as plain text and as simple HTML. `link` goes behind the button. */
export function compose(kind: MailKind, language: MailLanguage, link?: string) {
  const mail = TEXTS[language][kind]
  const text = [...mail.lines, ...(link ? ['', link] : [])].join('\n')
  const paragraphs = mail.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
  const button =
    link && mail.action
      ? `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#f08a5d;color:#2a1a12;text-decoration:none;font-weight:600">${escapeHtml(mail.action)}</a></p><p style="color:#777;font-size:13px">${escapeHtml(link)}</p>`
      : ''
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:520px">${paragraphs}${button}<p style="color:#777;font-size:13px">Couchwarp</p></div>`
  return { subject: mail.subject, text, html }
}

/** Sends one message. Errors go up: the caller decides whether the person must know. */
export async function sendMail(
  env: Env,
  to: string,
  kind: MailKind,
  language: MailLanguage,
  link?: string,
): Promise<void> {
  const message = compose(kind, language, link)
  if (!mailConfigured(env)) {
    console.log(`E-mail not sent (no RESEND_API_KEY): ${kind} to ${to}${link ? `, ${link}` : ''}`)
    return
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], ...message }),
  })
  if (!response.ok) {
    throw new Error(`Resend answered HTTP ${response.status}: ${await response.text()}`)
  }
}
