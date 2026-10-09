-- Additive: per-device choice of notification types.
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
