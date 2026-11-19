-- Public rooms, kept fresh by each room every minute; rows older than two minutes
-- belong to rooms that are gone and are never listed.
CREATE TABLE rooms (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  game TEXT NOT NULL,
  host_name TEXT NOT NULL,
  host_user_id TEXT,
  players INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  spectators INTEGER NOT NULL,
  country TEXT,
  continent TEXT,
  -- JSON array of the players' avatar URLs, null for guests without an account.
  avatars TEXT NOT NULL,
  has_thumbnail INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX rooms_by_freshness ON rooms(updated_at);

-- Games played by signed-in people, for their history page.
CREATE TABLE play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL,
  title TEXT NOT NULL,
  game TEXT NOT NULL,
  host_name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER
);
CREATE INDEX play_history_by_user ON play_history(user_id, joined_at);

-- Kicks, bans and role changes, kept for moderation and the DSA notice-and-action duty.
CREATE TABLE moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_user_id TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX moderation_log_by_target ON moderation_log(target_user_id);
