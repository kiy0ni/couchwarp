/** Sign-in providers. Each one is enabled once its client id and secret are set. */

export interface Profile {
  providerUserId: string
  username: string
  displayName: string
  avatarUrl: string | null
}

export interface Provider {
  id: ProviderId
  authorizeUrl: string
  tokenUrl: string
  scope: string
  credentials(env: Env): { clientId: string; clientSecret: string } | null
  profile(accessToken: string): Promise<Profile>
}

export type ProviderId = 'discord' | 'google'

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return response.json<T>()
}

const discord: Provider = {
  id: 'discord',
  authorizeUrl: 'https://discord.com/oauth2/authorize',
  tokenUrl: 'https://discord.com/api/oauth2/token',
  scope: 'identify',
  credentials: (env) =>
    env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
      ? { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET }
      : null,
  async profile(accessToken) {
    const me = await getJson<{
      id: string
      username: string
      global_name: string | null
      avatar: string | null
    }>('https://discord.com/api/users/@me', accessToken)
    return {
      providerUserId: me.id,
      username: me.username,
      displayName: me.global_name ?? me.username,
      avatarUrl: me.avatar
        ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128`
        : null,
    }
  },
}

const google: Provider = {
  id: 'google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scope: 'openid profile',
  credentials: (env) =>
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : null,
  async profile(accessToken) {
    const me = await getJson<{ sub: string; name?: string; picture?: string }>(
      'https://openidconnect.googleapis.com/v1/userinfo',
      accessToken,
    )
    const name = me.name ?? 'Joueur'
    return {
      providerUserId: me.sub,
      username: name,
      displayName: name,
      avatarUrl: me.picture ?? null,
    }
  },
}

export const PROVIDERS: Readonly<Record<ProviderId, Provider>> = { discord, google }

export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS
}

export function enabledProviders(env: Env): ProviderId[] {
  return Object.values(PROVIDERS)
    .filter((provider) => provider.credentials(env) !== null)
    .map((provider) => provider.id)
}

/** Trades the code the provider sent back for an access token. */
export async function exchangeCode(
  provider: Provider,
  env: Env,
  code: string,
  redirectUri: string,
): Promise<string> {
  const credentials = provider.credentials(env)
  if (!credentials) throw new Error(`${provider.id} is not configured`)
  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!response.ok)
    throw new Error(`${provider.id} token exchange answered HTTP ${response.status}`)
  const { access_token: accessToken } = await response.json<{ access_token: string }>()
  return accessToken
}
