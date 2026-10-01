-- v0.28.2 — isolate News Factory data by workspace/account.
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'ai-main';
ALTER TABLE collector_runs ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'ai-main';
ALTER TABLE app_snapshots ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'ai-main';
ALTER TABLE public_post_pages ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'ai-main';

ALTER TABLE news_items DROP CONSTRAINT IF EXISTS news_items_original_url_key;
DROP INDEX IF EXISTS news_items_workspace_url_uidx;
CREATE UNIQUE INDEX news_items_workspace_url_uidx ON news_items(workspace_id, original_url);

CREATE INDEX IF NOT EXISTS news_items_workspace_idx ON news_items(workspace_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS collector_runs_workspace_idx ON collector_runs(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS app_snapshots_workspace_idx ON app_snapshots(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS public_post_pages_workspace_idx ON public_post_pages(workspace_id, created_at DESC);
