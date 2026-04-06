-- 005: Multi-source pipeline expansion
-- Adds source_id composite key, diff detection, detail fields, AI classification columns

-- Source identification (replaces portal_id as dedup key)
ALTER TABLE grants ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS cfda_numbers text[];

-- Drop old portal_id unique constraint, make nullable
ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_portal_id_key;
ALTER TABLE grants ALTER COLUMN portal_id DROP NOT NULL;

-- Diff detection (two-phase hashing)
ALTER TABLE grants ADD COLUMN IF NOT EXISTS search_hash text;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS detail_hash text;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS raw_json jsonb;

-- Detail tracking (from fetchOpportunity)
ALTER TABLE grants ADD COLUMN IF NOT EXISTS detail_fetched boolean NOT NULL DEFAULT false;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS detail_fetched_at timestamptz;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS synopsis text;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS eligibility text;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS award_floor integer;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS award_ceiling integer;

-- LLM classification (written by Claude Code or future Vercel function)
ALTER TABLE grants ADD COLUMN IF NOT EXISTS ai_tags text[];
ALTER TABLE grants ADD COLUMN IF NOT EXISTS ai_summary text;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS ai_classified_at timestamptz;

-- Sync bookkeeping (for safe reconciliation)
ALTER TABLE grants ADD COLUMN IF NOT EXISTS last_seen_in_sync timestamptz;

-- IMPORTANT: Backfill MUST run BEFORE the unique constraint.
-- If source_id is NULL when UNIQUE is added, it fails on second row.
UPDATE grants SET source_id = portal_id::text WHERE source = 'ca_portal' AND source_id IS NULL;
-- NOTE: Verify that (portal_id * -1) equals the original Grants.gov opportunity ID.
-- If not, federal grants will get duplicated instead of upserted on next sync.
UPDATE grants SET source_id = (portal_id * -1)::text WHERE source = 'grants_gov' AND source_id IS NULL;

-- Now safe to add constraint — all rows have source_id populated
ALTER TABLE grants ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE grants ADD CONSTRAINT uq_source_source_id UNIQUE (source, source_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_grants_source ON grants (source);
CREATE INDEX IF NOT EXISTS idx_grants_source_source_id ON grants (source, source_id);
CREATE INDEX IF NOT EXISTS idx_grants_ai_tags ON grants USING GIN (ai_tags);
CREATE INDEX IF NOT EXISTS idx_grants_cfda ON grants USING GIN (cfda_numbers);
CREATE INDEX IF NOT EXISTS idx_grants_search_hash ON grants (search_hash);
CREATE INDEX IF NOT EXISTS idx_grants_ai_classified ON grants (ai_classified_at);
CREATE INDEX IF NOT EXISTS idx_grants_last_seen ON grants (last_seen_in_sync);

-- Digest idempotency: add digest_week column and unique constraint
ALTER TABLE digests ADD COLUMN IF NOT EXISTS digest_week text;
-- Backfill existing digests with ISO week
UPDATE digests SET digest_week = to_char(sent_at, 'IYYY-IW') WHERE digest_week IS NULL;
ALTER TABLE digests ADD CONSTRAINT uq_digest_org_week UNIQUE (org_id, digest_week);
