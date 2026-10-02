-- Promotion / audience growth tracking for News Factory.
-- Additive only: keeps subscriber snapshots and manually attributed promotion campaigns.

CREATE TABLE IF NOT EXISTS promotion_snapshots (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  subscribers INTEGER,
  views BIGINT NOT NULL DEFAULT 0,
  engagement_rate NUMERIC(10,4),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS promotion_snapshots_workspace_platform_time_idx
  ON promotion_snapshots(workspace_id, platform, recorded_at DESC);

CREATE TABLE IF NOT EXISTS promotion_campaigns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'telegram',
  source_type TEXT NOT NULL DEFAULT 'other',
  source_name TEXT NOT NULL DEFAULT '',
  spend_rub NUMERIC(14,2) NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  attributed_subscribers INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS promotion_campaigns_workspace_started_idx
  ON promotion_campaigns(workspace_id, started_at DESC);
