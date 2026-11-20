/**
 * The daily clean-up, run by a cron trigger: data is kept only as long as the privacy
 * page says (`apps/web/src/screens/Legal.tsx`). Change both together.
 */

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const YEAR_MS = 365 * DAY_MS

export async function cleanUp(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(now - HOUR_MS),
    db.prepare('DELETE FROM rooms WHERE updated_at < ?').bind(now - DAY_MS),
    // A room that crashed never closed its history rows.
    db
      .prepare(
        'UPDATE play_history SET left_at = joined_at WHERE left_at IS NULL AND joined_at < ?',
      )
      .bind(now - DAY_MS),
    db.prepare('DELETE FROM play_history WHERE joined_at < ?').bind(now - YEAR_MS),
    db.prepare('DELETE FROM moderation_log WHERE at < ?').bind(now - YEAR_MS),
    db
      .prepare('DELETE FROM reports WHERE decided_at IS NOT NULL AND decided_at < ?')
      .bind(now - YEAR_MS),
    db
      .prepare('DELETE FROM friendships WHERE accepted_at IS NULL AND created_at < ?')
      .bind(now - 90 * DAY_MS),
    db.prepare('DELETE FROM login_failures WHERE at < ?').bind(now - DAY_MS),
  ])
}
