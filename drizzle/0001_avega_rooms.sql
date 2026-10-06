CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rooms_updated_at_idx ON rooms(updated_at);
