/** Counting recent attempts, to slow down guessing and floods. */

/**
 * Records an attempt in `bucket` and says whether it is within `limit` per `windowMs`.
 * Refused attempts are not recorded, so waiting is enough to be let in again.
 */
export async function allow(
  db: D1Database,
  bucket: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<boolean> {
  const count = await db
    .prepare('SELECT COUNT(*) AS count FROM rate_events WHERE bucket = ? AND at > ?')
    .bind(bucket, now - windowMs)
    .first<number>('count')
  if ((count ?? 0) >= limit) return false
  await db.prepare('INSERT INTO rate_events (bucket, at) VALUES (?, ?)').bind(bucket, now).run()
  return true
}

/** A bucket for the network a request comes from; the address itself is never stored. */
export async function networkBucket(request: Request, purpose: string): Promise<string> {
  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`rate:${purpose}:${address}`),
  )
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0'))
  return `${purpose}:${hex.join('')}`
}
