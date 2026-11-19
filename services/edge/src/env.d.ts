// Secrets and optional settings, set with `wrangler secret put` or in `.dev.vars`.
interface Env {
  /** The site's address, e.g. https://couchwarp.example. Defaults to the request's own. */
  PUBLIC_URL?: string
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}
