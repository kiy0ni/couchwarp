/** Creating an account: the user row, with a tag of its own. */

const TAG_DRAWS = 5

/** Six digits, so a tag never starts with a zero that people would drop. */
function randomTag(): number {
  return 100000 + ((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 900000)
}

/**
 * Inserts a new user and, in the same batch, whatever `more` adds for it (how it signs
 * in). A tag that clashes with an existing one is drawn again.
 */
export async function createUser(
  db: D1Database,
  profile: {
    displayName: string
    avatarUrl: string | null
    ageConfirmedAt?: number | null
    email?: string | null
  },
  more: (userId: string) => D1PreparedStatement[],
): Promise<string> {
  const userId = crypto.randomUUID()
  const now = Date.now()
  for (let draw = 0; ; draw++) {
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO users (id, display_name, avatar_url, tag, age_confirmed_at, email, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            userId,
            profile.displayName,
            profile.avatarUrl,
            randomTag(),
            profile.ageConfirmedAt ?? null,
            profile.email ?? null,
            now,
          ),
        ...more(userId),
      ])
      return userId
    } catch (error) {
      if (draw >= TAG_DRAWS || !String(error).includes('users.tag')) throw error
    }
  }
}
