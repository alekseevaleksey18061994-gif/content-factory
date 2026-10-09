-- Additive: in-app notification feed (bell in the admin) and Web Push subscriptions of the owner's devices.
CREATE TABLE IF NOT EXISTS app_notifications (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  workspace_id TEXT NOT NULL DEFAULT '',
  read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS app_notifications_at_idx ON app_notifications (at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  keys        JSONB NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
