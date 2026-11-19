-- Accounts are optional: guests can always join with a nickname.
-- Only what the features need is stored (GDPR data minimisation).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  -- Set once the person confirms they are 13 or older; null until then.
  age_confirmed_at INTEGER,
  -- Banned from the platform until this Unix time, in ms; null when not banned.
  banned_until INTEGER,
  ban_reason TEXT,
  created_at INTEGER NOT NULL
);

-- One row per sign-in method attached to a user (Discord, Google...).
CREATE TABLE identities (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX identities_by_user ON identities(user_id);

-- Only a hash of each session token is kept, so a database leak gives no working session.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'web' (browser cookie) or 'host' (bearer token held by the host app).
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_user ON sessions(user_id);

-- Pending sign-ins, to check the state returned by the provider (CSRF) and to
-- remember where to send the person back. Rows live ten minutes.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  -- Set when a signed-in user adds a provider to their account.
  link_user_id TEXT,
  -- 'web', or 'host' with a loopback address to return the token to.
  client TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
