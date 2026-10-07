-- Additive: remembers a checksum of each applied migration file so a later edit of an applied file is detected.
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;
