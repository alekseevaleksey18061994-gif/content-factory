CREATE TABLE IF NOT EXISTS cost_events (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  kind TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cached_input_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  cache_write_tokens BIGINT NOT NULL DEFAULT 0,
  image_input_tokens BIGINT NOT NULL DEFAULT 0,
  image_output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0,
  pricing_known BOOLEAN NOT NULL DEFAULT FALSE,
  estimated BOOLEAN NOT NULL DEFAULT FALSE,
  news_id TEXT NULL,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS cost_events_workspace_at_idx ON cost_events(workspace_id, at DESC);
CREATE INDEX IF NOT EXISTS cost_events_at_idx ON cost_events(at DESC);
CREATE INDEX IF NOT EXISTS cost_events_news_id_idx ON cost_events(news_id);
