// Secrets and optional settings, set with `wrangler secret put` or in `.dev.vars`.
interface Env {
  /** The site's address, e.g. https://couchwarp.example. Defaults to the request's own. */
  PUBLIC_URL?: string
  /** "on" lists public rooms. Off until moderation is staffed: rooms then stay link-only. */
  PUBLIC_ROOMS?: string
  /** Cloudflare's TURN service: a TURN key and its API token. */
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  /** Or a TURN server of one's own (coturn): its addresses, comma-separated, and the secret it shares. */
  TURN_URLS?: string
  TURN_SECRET?: string
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
  /** E-mails (confirmation, password reset) go through Resend: its API key and the sender. */
  RESEND_API_KEY?: string
  /** The sender, e.g. `Couchwarp <no-reply@example.com>`, on a domain verified at Resend. */
  MAIL_FROM?: string
  /** Comma-separated account ids of the people who handle reports. */
  ADMIN_USER_IDS?: string
}
