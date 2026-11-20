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
  /** Where the desktop app installers are, shown on the Host page. Default: the latest release. */
  DOWNLOAD_MAC_URL?: string
  DOWNLOAD_WINDOWS_URL?: string
  /** The GitHub repository whose releases carry the desktop app, as `owner/name`. */
  RELEASES_REPO?: string
  /** A read-only GitHub token, needed while that repository is private. */
  RELEASES_TOKEN?: string
  /** Comma-separated account ids of the people who handle reports. */
  ADMIN_USER_IDS?: string
}
