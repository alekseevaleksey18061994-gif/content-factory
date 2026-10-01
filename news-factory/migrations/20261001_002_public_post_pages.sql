CREATE TABLE IF NOT EXISTS public_post_pages (
  slug TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  topic_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_name TEXT,
  source_url TEXT,
  image_filename TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_width INTEGER NOT NULL,
  image_height INTEGER NOT NULL,
  image_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS public_post_pages_post_idx
  ON public_post_pages(post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS public_post_pages_created_idx
  ON public_post_pages(created_at DESC);
