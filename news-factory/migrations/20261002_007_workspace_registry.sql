-- Additive: remembers every workspace (channel) ever seen so a vanished one can be detected and alerted on.
CREATE TABLE IF NOT EXISTS workspace_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ
);
