import type { IceServer } from '@couchwarp/protocol'

const STUN_ONLY: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }]
/** Longer than any play session, as Cloudflare recommends. */
const CREDENTIAL_TTL_SECONDS = 12 * 60 * 60

/**
 * Whether this server hands out a relay: Cloudflare's TURN service (a TURN key), or a
 * TURN server of one's own, such as coturn, sharing a secret with this server.
 */
export function relayConfigured(env: Env): boolean {
  return Boolean((env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) || (env.TURN_URLS && env.TURN_SECRET))
}

/**
 * ICE servers handed to a guest. With a relay configured, this includes it, for
 * networks that block direct connections (CGNAT, school or office firewalls) and for
 * guests whose address the host must not see.
 */
export async function iceServersFor(env: Env, now = Date.now()): Promise<IceServer[]> {
  if (env.TURN_URLS && env.TURN_SECRET) {
    return [...STUN_ONLY, await sharedSecretServer(env.TURN_URLS, env.TURN_SECRET, now)]
  }
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    return cloudflareServers(env.TURN_KEY_ID, env.TURN_KEY_API_TOKEN)
  }
  return STUN_ONLY
}

/**
 * Short-lived credentials for a TURN server that shares `secret` with this server
 * (coturn's `use-auth-secret`, the "TURN REST API"): the user name is the expiry time,
 * the password its HMAC-SHA1. The secret itself never leaves this server.
 */
export async function sharedSecretServer(
  urls: string,
  secret: string,
  now: number,
): Promise<IceServer> {
  const username = `${Math.floor(now / 1000) + CREDENTIAL_TTL_SECONDS}:couchwarp`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username))
  return {
    urls: urls
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
    username,
    credential: btoa(String.fromCharCode(...new Uint8Array(signature))),
  }
}

async function cloudflareServers(keyId: string, token: string): Promise<IceServer[]> {
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
    },
  )
  if (!response.ok) {
    // The guest can still connect directly on most networks, so the room stays usable.
    console.error(`TURN credentials failed with HTTP ${response.status}`)
    return STUN_ONLY
  }
  const { iceServers } = await response.json<{ iceServers: IceServer[] }>()
  // Browsers time out on port 53, Cloudflare's docs advise dropping those URLs.
  return iceServers.map((server) => ({
    ...server,
    urls: server.urls.filter((url) => !/:53(\?|$)/.test(url)),
  }))
}
