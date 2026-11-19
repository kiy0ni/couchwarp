-- Reports sent from a room or the public list, and what was decided about them
-- (notice and action under the Digital Services Act: every decision keeps its reason).
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  room_title TEXT NOT NULL,
  reporter_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Salted hash of the reporter's address, only to limit how often one place reports.
  reporter_hash TEXT NOT NULL,
  -- Null when the report is about the room itself.
  target_name TEXT,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- Set once handled: dismissed, room-closed or account-suspended.
  decision TEXT,
  decision_note TEXT,
  decided_by TEXT,
  decided_at INTEGER
);
CREATE INDEX reports_by_state ON reports(decided_at, created_at);
CREATE INDEX reports_by_reporter ON reports(reporter_hash, created_at);

-- A friend request, accepted once `accepted_at` is set. One row per pair, in the
-- direction it was asked.
CREATE TABLE friendships (
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  PRIMARY KEY (requester_id, addressee_id)
);
CREATE INDEX friendships_by_addressee ON friendships(addressee_id);

-- Hosts are in the history too, so friends see who is hosting.
ALTER TABLE play_history ADD COLUMN hosted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX play_history_by_room ON play_history(room_code, left_at);
