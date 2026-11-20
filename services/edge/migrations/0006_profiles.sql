-- A profile beyond the name and picture of the sign-in account: a picture of one's own,
-- and one of the four player colours.
CREATE TABLE avatars (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
ALTER TABLE users ADD COLUMN color TEXT;
