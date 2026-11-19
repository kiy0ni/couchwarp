// Secrets, set with `wrangler secret put` or in `.dev.vars`. Both are optional.
interface Env {
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
}
