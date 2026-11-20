-- Accounts with a login (an email address or a name) and a password, for people without
-- Discord or Google. Only a PBKDF2 hash of the password is kept.
CREATE TABLE passwords (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  login TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Failed sign-ins per login, to slow down guessing; cleared by the daily clean-up.
CREATE TABLE login_failures (
  login TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_failures_by_login ON login_failures(login, at);
