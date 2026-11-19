// Secrets and optional settings, set with `wrangler secret put` or in `.dev.vars`.
interface Env {
  /** The site's address, e.g. https://couchwarp.example. Defaults to the request's own. */
  PUBLIC_URL?: string
  /** "on" lists public rooms. Off until moderation is staffed: rooms then stay link-only. */
  PUBLIC_ROOMS?: string
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** Comma-separated account ids of the people who handle reports. */
  ADMIN_USER_IDS?: string
}
