-- What a host lets each friend do as soon as they join one of the host's games, on top of
-- the controller every player has. Changed from the Friends page, per friend.
CREATE TABLE friend_permissions (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keyboard INTEGER NOT NULL DEFAULT 0,
  mouse INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, friend_id)
);
