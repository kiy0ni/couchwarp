-- E-mail addresses: confirmed by a link, used to reset a forgotten password and to
-- warn about changes to the account. Only the address and when it was confirmed are kept.
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
CREATE UNIQUE INDEX users_by_email ON users(email) WHERE email IS NOT NULL;

-- Logins that were already e-mail addresses become the account's address, unconfirmed.
UPDATE users SET email = (
  SELECT login FROM passwords WHERE passwords.user_id = users.id AND login LIKE '%_@_%._%'
);

-- Links sent by e-mail. Only a SHA-256 hash of each token is kept; a link works once.
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'verify' (confirm the address), 'change' (confirm a new one) or 'reset' (password).
  purpose TEXT NOT NULL,
  -- The address the link went to: the new one, for a change.
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX email_tokens_by_user ON email_tokens(user_id, purpose);

-- Recent attempts per bucket (a hashed network address, an address, an account), to
-- slow down guessing and stop e-mail floods. Cleared by the daily clean-up.
CREATE TABLE rate_events (
  bucket TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX rate_events_by_bucket ON rate_events(bucket, at);
