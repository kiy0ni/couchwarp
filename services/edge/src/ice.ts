import type { IceServer } from '@couchwarp/protocol'

const STUN_ONLY: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }]
/** Longer than any play session, as Cloudflare recommends. */
const CREDENTIAL_TTL_SECONDS = 12 * 60 * 60

/**
 * ICE servers handed to a guest. With a Cloudflare TURN key, this includes a relay
 * for networks that block direct connections (CGNAT, school or office firewalls).
 */
export async function iceServersFor(env: Env): Promise<IceServer[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
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
