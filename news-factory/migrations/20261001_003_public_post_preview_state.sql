ALTER TABLE public_post_pages ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public_post_pages ADD COLUMN IF NOT EXISTS preflight_status TEXT;
ALTER TABLE public_post_pages ADD COLUMN IF NOT EXISTS preflight_checked_at TIMESTAMPTZ;
ALTER TABLE public_post_pages ADD COLUMN IF NOT EXISTS vk_post_id BIGINT;
ALTER TABLE public_post_pages ADD COLUMN IF NOT EXISTS vk_error_code TEXT;
ALTER TABLE public_post_pages ADD COLUMN IF NOT EXISTS vk_error_msg TEXT;
CREATE INDEX IF NOT EXISTS public_post_pages_vk_post_idx ON public_post_pages(vk_post_id) WHERE vk_post_id IS NOT NULL;
