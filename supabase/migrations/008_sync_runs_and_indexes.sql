-- 008: Clean slate — wipe unfiltered grants, drop raw_json, add observability
-- Context: Original scrapes had zero filtering. 2,860 grants including agriculture,
-- defense, transportation, etc. Rebuilding with only relevant categories.

-- ============================================================
-- 1. Wipe all grants (will re-scrape with filters)
-- ============================================================
DELETE FROM grants;

-- ============================================================
-- 2. Drop raw_json column (bloat — full API response per federal grant)
-- ============================================================
ALTER TABLE grants DROP COLUMN IF EXISTS raw_json;

-- ============================================================
-- 3. sync_runs: audit trail for every scraper execution
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,               -- 'ca_portal' | 'grants_gov'
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  grants_fetched int NOT NULL DEFAULT 0,
  grants_new int NOT NULL DEFAULT 0,
  grants_closed int NOT NULL DEFAULT 0,
  error text,
  duration_ms int
);

CREATE INDEX idx_sync_runs_source ON sync_runs (source, started_at DESC);

-- ============================================================
-- 4. Missing indexes on grants table
-- ============================================================

-- Partial index: active grants only (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_grants_active_deadline
  ON grants (deadline_date DESC)
  WHERE status IN ('active', 'forecasted');

-- Composite: source + status (sync reconciliation and monitoring)
CREATE INDEX IF NOT EXISTS idx_grants_source_status
  ON grants (source, status);

-- Unclassified grants queue (find grants needing classification)
CREATE INDEX IF NOT EXISTS idx_grants_unclassified
  ON grants (first_seen_at ASC)
  WHERE ai_classified_at IS NULL;
