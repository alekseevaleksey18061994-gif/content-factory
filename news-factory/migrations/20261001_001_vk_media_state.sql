CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE news_items ADD COLUMN IF NOT EXISTS topic_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS vk_post_id BIGINT;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS vk_status TEXT;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS vk_error_code TEXT;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS vk_error_msg TEXT;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS vk_media_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS news_items_topic_idx ON news_items(topic_id);
CREATE INDEX IF NOT EXISTS news_items_vk_status_idx ON news_items(vk_status);
