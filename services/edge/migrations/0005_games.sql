-- Games recognised from a name, so rooms show the right title and cover. A row with no
-- app_id remembers that nothing matched, so the store is not asked again too soon.
CREATE TABLE game_lookups (
  query TEXT PRIMARY KEY,
  app_id INTEGER,
  name TEXT,
  fetched_at INTEGER NOT NULL
);
