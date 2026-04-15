# Grant Discovery Pipeline Expansion

Design spec for expanding GrantRadar from a single-source CA grant digest into a multi-source grant discovery pipeline with LLM classification.

## Problem

GrantRadar currently ingests ~1,874 grants from one source (CA Grants Portal CSV). A federal sync route exists but is unscheduled, uses a legacy API endpoint, has no diff detection, and dumps all ~2,800 posted opportunities with no intelligence layer. There is no LLM classification — matching is keyword substring only. The Pro tier promises "AI Fit Score" and "AI narrative drafts" but neither exists.

NSH (anchor user) needs federal preservation grants surfaced automatically. Paying users need a reason to pay $19/mo beyond what the free CA portal alerts already provide.

## Architecture Decision

**GrantRadar is the data warehouse. Claude Code is the intelligence layer (for now).**

GrantRadar handles: ingestion, storage, diff detection, digest delivery, web UI.
Claude Code handles: LLM classification, fit scoring, analysis — run locally, results written back to Supabase.

This means no Anthropic API key in Vercel env vars. Classification runs on Kaelen's machine during `/grants` or `/today` flow. When the product matures, the LLM layer moves into GrantRadar as a Vercel function with its own API key. The database schema supports both modes — columns exist regardless of where the classifier runs.

## Pre-Requisite Hotfix

**CRITICAL BUG:** The CA portal sync (`src/lib/grants.ts:118`) marks any grant NOT in the CA CSV as "closed." Federal grants (negative `portal_id`) are never in the CA CSV. So every daily CA sync closes every federal grant. This is a live data corruption cycle.

**Fix:** Add `.eq("source", "ca_portal")` to the close query. One-line change. Must deploy before running any federal sync on a schedule.

**Also fix (digest sender):**
- No error isolation per org — one failure kills all remaining orgs' emails. Wrap each org in try/catch.
- Grant fetch happens once per org (N identical full-table scans) — fetch once outside the loop.
- Not idempotent — no "already sent this period" guard. If cron retries or fires twice, every org gets double emails. Add dedup key: `(org_id, digest_week)` unique constraint on digests table.
- DB errors masquerade as "no matches" — `matchGrantsForOrg` returns `[]` on Supabase error, logged as "skipped_empty." Must throw on DB error, not silently return empty.
- Response payload misleading — `sent: results.length` includes skips and failures. Return `{ sent, skipped, failed }` separately.

## Scope

This spec covers three deliverables:

1. **Smart Federal Ingestor** — diff detection, scheduled cron, detail fetching, correct API endpoint
2. **Multi-Source Schema** — database changes to support N sources, AI classification, raw payload storage
3. **Claude Code `/grants` Skill** — second brain integration that queries Supabase and runs LLM classification locally

**Day 1 Deliverable (NSH-specific):**
- NSH grant eligibility profile created at `~/vault/grants/nsh-grant-profile.md` — keywords, CFDA numbers, target funders, positioning notes
- 2026 grant opportunities researched and filed at `~/vault/research/notes/2026-04-05-nsh-grant-opportunities-2026.md` — 6 specific programs identified with timing and action items
- The `/grants` skill uses this profile to filter and score grants from all sources

**Critical insight from research:** The most actionable grants for NSH are private foundations (1772 Foundation, Schwemm, community foundations), not federal programs. Federal grants (SAT, HER) are high-value but highly competitive and require match funds NSH doesn't have. The pipeline must track private foundation deadlines, not just scrape Grants.gov.

**What the pipeline actually does for NSH:**
1. Monitors Grants.gov for CFDA numbers matching preservation (automated, daily)
2. Monitors CA Portal for state grants (already working)
3. Tracks private foundation deadline cycles from the profile's target funders list (manual entries + future scrapers)
4. Alerts when a window opens for any tracked funder
5. LLM-scores each discovered grant against NSH's profile

Out of scope (future specs):
- Niche preservation site scrapers (NTHP, 1772, Getty, CA OHP) — **high priority follow-on**, these are where NSH's best-fit grants live
- Pro tier AI narrative drafts (Vercel-hosted LLM)
- Grant bookmarking / pipeline tracking UI
- SPF/DKIM email deliverability
- Candid/Foundation Directory integration (requires library access, TOS prohibits automation)

---

## 1. Smart Federal Ingestor

### Current Problems

| Problem | Impact |
|---------|--------|
| Uses legacy endpoint `apply07.grants.gov/grantsws/rest/opportunities/search` | Will break when Grants.gov retires it |
| Fetches ALL posted opportunities every run | Wasteful, no way to detect changes |
| 5,000 record safety cap | Arbitrary, may miss grants |
| Negative `portal_id` hack (-1 * grants.gov ID) | Collisions possible if CA portal ever uses negative IDs; confusing to query |
| No `fetchOpportunity` detail call | Missing synopsis, eligibility, description — the fields LLM classification needs |
| No cron schedule | Federal sync never runs automatically |
| No error recovery | If API is down, sync silently fails |

### Design

#### Data Source Strategy

Two options evaluated:

| Approach | Pros | Cons |
|----------|------|------|
| **search2 API (paginated)** | Simple, unauthenticated, filters by status/agency/keyword | No bulk option, ~2,800 results to paginate, no documented rate limits |
| **Daily XML Extract** | Full catalog (75MB zip), published daily, intended for DB mirrors | Large download, XML parsing, includes closed/archived |

**Decision: search2 for daily delta, XML extract as optional full-refresh fallback.**

Daily workflow:
1. Call `search2` with `oppStatuses: "posted"`, paginate through all results (250/page)
2. For each opportunity, compute `payload_hash` from normalized key fields
3. Compare against stored hash — skip unchanged grants
4. For new or changed grants, call `fetchOpportunity` to get full detail (synopsis, eligibility)
5. Upsert to `grants` table with source, hash, raw JSON, timestamps

6. **Reconciliation:** Every grant seen in this sync gets `last_seen_in_sync = now()`. After sync completes, any `grants_gov` grant where `last_seen_in_sync` is older than 3 days AND `status = 'active'` → mark `status: 'closed'`. **Safety guards:** (a) Only reconcile if fetched count is above 80% of previous run's count. (b) If the API returned suspiciously few results, skip reconciliation entirely and log a warning. (c) The 3-day buffer prevents a single bad sync from mass-closing grants. This is bookkeeping-based reconciliation, not set-difference — much safer than "close everything not in today's list."

This gives us diff detection (only process changes), full detail (for LLM classification later), and proper lifecycle management.

#### API Endpoint

Switch from legacy to REST:
- **Search:** `https://api.grants.gov/v1/api/search2` (POST, unauthenticated)
- **Detail:** `https://api.grants.gov/v1/api/fetchOpportunity` (GET, unauthenticated)
- **Staging:** `https://api.staging.grants.gov` for testing

#### Payload Hash

**Two-phase hashing:**

Phase 1 hash (from search2 — computed on every sync):
- `title`
- `closeDate`
- `awardCeiling` / `awardFloor`
- `fundingCategories`
- `oppStatus`

Phase 2 hash (from fetchOpportunity — computed only when detail is fetched):
- `synopsis`
- `eligibility`
- Full phase 1 fields

The phase 1 hash triggers detail re-fetch when it changes. The phase 2 hash triggers reclassification. This resolves the chicken-and-egg: you don't need detail fields to detect that something changed — title, dates, and amounts from search2 are sufficient.

Hash algorithm: SHA-256 of JSON.stringify(sorted normalized fields). Stored as `payload_hash text` on grants table.

Fields NOT included in hash (cosmetic changes we ignore):
- `lastUpdatedDate` (changes on every metadata touch)
- `version` (internal Grants.gov versioning)
- `agencyContactInfo` (contact rotations aren't meaningful)

#### Detail Fetching

Only fetch full details for:
- New grants (no existing `payload_hash`)
- Changed grants (hash mismatch)
- Grants missing `ai_summary` (backfill)

This keeps API calls to ~10-50/day for delta, not 2,800.

#### Error Handling

- Exponential backoff: 1s, 2s, 4s, max 3 retries per request
- If search2 returns error/empty after retries, log error and skip (don't wipe existing data)
- If fetchOpportunity fails for a specific grant, store what we have from search2, mark `detail_fetched: false`
- idempotent upserts (already have this via `onConflict`)

#### Cron Schedule

Add to `vercel.json`:
```json
{
  "path": "/api/sync-federal",
  "schedule": "0 14 * * *"
}
```
Run at 2 PM UTC (6 AM PT) daily, 1 hour after CA sync.

#### Source Identification

Replace the negative `portal_id` hack. New approach:
- Add `source_id text` column — the grant's ID within its source system (e.g., Grants.gov opportunity number, CA portal ID)
- Add unique constraint on `(source, source_id)` instead of `portal_id`
- `portal_id` becomes nullable, kept for backward compat with CA portal grants
- Federal grants: `source = 'grants_gov'`, `source_id = opportunity.id`
- CA grants: `source = 'ca_portal'`, `source_id = portal_id::text`

This scales to N sources without collision hacks.

---

## 2. Multi-Source Schema

### New Columns on `grants` Table

```sql
-- Source identification (replaces portal_id as dedup key)
ALTER TABLE grants ADD COLUMN source_id text;
ALTER TABLE grants ADD COLUMN cfda_numbers text[]; -- structured CFDA for federal grants

-- Drop old portal_id unique constraint, make nullable
ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_portal_id_key;
ALTER TABLE grants ALTER COLUMN portal_id DROP NOT NULL;

-- Diff detection (two-phase: search_hash from search2, detail_hash after fetchOpportunity)
ALTER TABLE grants ADD COLUMN search_hash text;   -- hash of search2 fields (title, dates, amounts)
ALTER TABLE grants ADD COLUMN detail_hash text;    -- hash of detail fields (synopsis, eligibility)
ALTER TABLE grants ADD COLUMN raw_json jsonb;

-- Detail tracking
ALTER TABLE grants ADD COLUMN detail_fetched boolean NOT NULL DEFAULT false;
ALTER TABLE grants ADD COLUMN detail_fetched_at timestamptz;
ALTER TABLE grants ADD COLUMN synopsis text;
ALTER TABLE grants ADD COLUMN eligibility text;
ALTER TABLE grants ADD COLUMN award_floor integer;
ALTER TABLE grants ADD COLUMN award_ceiling integer;

-- LLM classification (written by Claude Code locally, or future Vercel function)
ALTER TABLE grants ADD COLUMN ai_tags text[];
ALTER TABLE grants ADD COLUMN ai_summary text;
ALTER TABLE grants ADD COLUMN ai_classified_at timestamptz;

-- Sync bookkeeping (for safe reconciliation)
ALTER TABLE grants ADD COLUMN last_seen_in_sync timestamptz;

-- Backfill source_id from existing data
UPDATE grants SET source_id = portal_id::text WHERE source = 'ca_portal';
UPDATE grants SET source_id = (portal_id * -1)::text WHERE source = 'grants_gov';

-- New dedup constraint
ALTER TABLE grants ADD CONSTRAINT uq_source_source_id UNIQUE (source, source_id);

-- Indexes
CREATE INDEX idx_grants_source ON grants (source);
CREATE INDEX idx_grants_source_id ON grants (source, source_id);
CREATE INDEX idx_grants_ai_tags ON grants USING GIN (ai_tags);
CREATE INDEX idx_grants_cfda ON grants USING GIN (cfda_numbers);
CREATE INDEX idx_grants_search_hash ON grants (search_hash);
CREATE INDEX idx_grants_ai_classified ON grants (ai_classified_at);
CREATE INDEX idx_grants_last_seen ON grants (last_seen_in_sync);
```

### Migration Strategy

Single migration file `005_pipeline_expansion.sql`:
1. Add all new columns with defaults
2. Backfill `source_id` from `portal_id` for existing CA grants: `UPDATE grants SET source_id = portal_id::text WHERE source = 'ca_portal'`
3. Backfill `source_id` for existing federal grants: `UPDATE grants SET source_id = (portal_id * -1)::text WHERE source = 'grants_gov'`
4. Add unique constraint `(source, source_id)`
5. Keep `portal_id` column (nullable now — existing CA sync still writes it, federal sync no longer needs it)
6. Add indexes

### Schema After Migration

Key columns on `grants`:

| Column | Type | Source |
|--------|------|--------|
| `source` | text | `'ca_portal'`, `'grants_gov'`, future: `'nthp'`, `'getty'` |
| `source_id` | text | ID within source system |
| `portal_id` | int (nullable) | Legacy, kept for CA compat |
| `search_hash` | text | SHA-256 of search2 fields (title, dates, amounts) |
| `detail_hash` | text | SHA-256 of detail fields (synopsis, eligibility) |
| `cfda_numbers` | text[] | Structured CFDA numbers from API response |
| `last_seen_in_sync` | timestamptz | When this grant was last seen in a sync run |
| `raw_json` | jsonb | Full API response for replay |
| `detail_fetched` | boolean | Whether fetchOpportunity was called |
| `synopsis` | text | From detail fetch |
| `eligibility` | text | From detail fetch |
| `award_floor` | int | Parsed from detail |
| `award_ceiling` | int | Parsed from detail |
| `ai_tags` | text[] | LLM-generated theme tags |
| `ai_summary` | text | One-sentence LLM summary |
| `ai_classified_at` | timestamptz | When classification ran |
| — | — | Per-org fit scores deferred to Phase C (separate spec) |

---

## 3. Claude Code `/grants` Skill

### Purpose

A second brain skill that queries GrantRadar's Supabase during Kaelen's workflow. Surfaces relevant grants, runs LLM classification locally, writes results back to Supabase.

### Location

`~/.claude/commands/grants.md` (global command, works from any directory)

### Workflow

```
/grants [query]
  1. Query Supabase for grants matching NSH profile:
     - source IN ('ca_portal', 'grants_gov')
     - status IN ('active', 'forecasted')
     - deadline_date > today OR deadline_date IS NULL
     - ORDER BY first_seen_at DESC
  2. Filter by `cfda_numbers` column (overlap with NSH profile's CFDA list) + preservation keywords in title/synopsis
  3. For grants without ai_tags:
     - Run Haiku classification (batch, ~$0.001/grant)
     - Generate: ai_tags[], ai_summary
     - Write back to Supabase
  4. Display results:
     - New this week (first_seen_at > 7 days ago)
     - Closing soon (deadline_date < 14 days)
     - High relevance (ai_tags overlap with preservation keywords)
  5. If [query] provided, filter results by query string
```

### LLM Classification Prompt

```
You are classifying a federal/state grant opportunity for relevance to nonprofit organizations.

Given this grant:
Title: {title}
Agency: {agency}
Synopsis: {synopsis}
Eligibility: {eligibility}
Categories: {categories}
Award: ${award_floor} - ${award_ceiling}

Generate:
1. tags: An array of 3-8 theme tags (e.g., "historic preservation", "community development", "arts education", "rural infrastructure", "museum collections", "cultural heritage", "capacity building")
2. summary: One sentence describing what this grant funds and who it's for.

Return JSON: { "tags": [...], "summary": "..." }
```

Model: `claude-haiku-4-5-20251001` (fast, cheap, good enough for tagging)
Cost: ~$0.001/grant. Initial backfill of ~4,700 grants = ~$5.

### NSH-Specific CFDA Monitoring

The `/grants` command knows NSH's CFDA numbers from research:
- 15.929 (Save America's Treasures)
- 15.966 (HPF Underrepresented Communities)
- 45.024-026 (NEA)
- 45.129, 45.130, 45.160, 45.163, 45.164 (NEH)
- 45.301, 45.312, 45.313 (IMLS)
- 14.218, 14.228, 14.862 (HUD CDBG)
- 10.766, 10.769-772 (USDA Rural Development)

Grants matching these CFDAs get auto-flagged regardless of keyword matching.

### Supabase Access

Uses the same Supabase client as the web app. Credentials in `~/.claude/.env`:
- `SUPABASE_URL=https://ppsexpgopqzshkcknxqt.supabase.co`
- `SUPABASE_ANON_KEY=...` (already there from GrantRadar setup)

The skill runs a Python script (consistent with other second brain scripts in `~/.claude/scripts/`) that queries Supabase directly via `supabase-py`. No need for the web app's API routes.

**New Python dependencies** (add to `~/.claude/scripts/.venv/`):
- `supabase` — Supabase Python client
- `anthropic` — Claude API for classification

Install: `source ~/.claude/scripts/.venv/bin/activate && pip install supabase anthropic`

**RLS note:** The `/grants` skill writes `ai_tags` and `ai_summary` back to Supabase using the anon key. This only works because GrantRadar's Supabase project currently has no RLS on the grants table. If RLS is enabled later (it should be for production), either: (a) create a service-role key for the local script, or (b) add an RLS policy that allows anon writes to AI classification columns only. This is a known dependency — document it, don't forget it.

### Integration with /today

When `/today` runs, it can call `/grants --brief` to show:
- Count of new grants this week
- Any closing-soon deadlines matching NSH
- Any unclassified grants needing attention

This is optional — add to /today after /grants works standalone.

---

## 4. Matching Engine Updates

### Current State

`matching.ts` does:
1. Hard filter: category overlap (required)
2. Soft filter: geography keywords
3. Amount filter: skip below min
4. Keyword scoring: substring match in title (+50), purpose (+30), description (+20)

### Changes

Add `ai_tags` to the scoring:
```typescript
// After existing keyword scoring
if (grant.ai_tags && grant.ai_tags.length > 0) {
  for (const kw of org.mission_keywords) {
    const kwLower = kw.toLowerCase();
    if (grant.ai_tags.some(tag => tag.toLowerCase().includes(kwLower))) {
      score += 40;
      reasons.push(`"${kw}" in AI tags`);
    }
  }
}
```

Score weights after change:
- Title keyword match: +50
- AI tag match: +40
- Purpose keyword match: +30
- Description keyword match: +20

AI tags don't replace keyword matching — they augment it. A grant might not mention "historic preservation" in its title but might have it as an AI tag because the synopsis describes preservation work.

### Pro Tier: Deferred to Phase C (separate spec)

Per-org AI fit scoring requires authenticated sessions, a tenancy model, and Anthropic SDK in Vercel. Not in this spec.

---

## 5. Implementation Phases

### Phase A: Database + Federal Ingestor (GrantRadar repo)
0. **HOTFIX:** Fix CA sync closing federal grants (`grants.ts:118` — add source filter). Fix digest sender error isolation (try/catch per org, single grant fetch). Deploy immediately.
1. Write migration `005_pipeline_expansion.sql`
2. Rewrite `sync-federal/route.ts`:
   - Switch to `api.grants.gov/v1/api/search2`
   - Add payload hash computation
   - Add `fetchOpportunity` detail calls for new/changed grants
   - Use `source_id` instead of negative `portal_id`
   - Add exponential backoff
   - Increase `maxDuration` to 300
   - Parse real `applicant_types` from API response (not hardcoded "Nonprofit")
3. Update `sync-grants/route.ts` (CA sync) to populate `source_id`
4. Add federal sync to `vercel.json` crons
5. Update `matching.ts` to use `ai_tags` in scoring
6. Deploy and run initial federal sync

### Phase B: Claude Code /grants Skill (second brain)
1. Write `~/.claude/commands/grants.md`
2. Write classification script (`~/.claude/scripts/grant_classify.py`)
3. Run initial backfill: classify all ~4,700 existing grants
4. Test: `/grants` shows relevant preservation grants
5. Optional: hook into `/today` for daily grant summary

### Phase C: Pro Tier Fit Scoring — DEFERRED (separate spec)

Pro tier fit scoring requires authenticated org context, a tenancy model, and Anthropic SDK in Vercel. This is a product design problem, not a pipeline problem. Separate spec when we have paying users who need it.

**Phase A must land first.** Phase B depends on A's migration (needs `ai_tags`, `ai_summary`, `synopsis` columns to exist). Phase B can start development in parallel but cannot run against production until A is deployed. Phase C is a separate spec — removing from this document (see below).

---

## 6. Cost Analysis

| Operation | Model | Cost/call | Volume | Monthly Cost |
|-----------|-------|-----------|--------|-------------|
| Detail hydration (backfill) | — | free (API) | ~2,800 federal | One-time, separate script, NOT the daily cron |
| Grant classification (backfill) | Haiku | ~$0.001 | 4,700 one-time | $5 one-time (run locally via /grants, NOT in Vercel) |
| Grant classification (daily delta) | Haiku | ~$0.001 | ~30/day | $0.90/mo |
| Pro fit scoring | Haiku | ~$0.002 | ~100/mo (est) | $0.20/mo |
| Pro narrative drafts (future) | Sonnet | ~$0.03 | ~20/mo (est) | $0.60/mo |
| **Total ongoing** | | | | **~$1.70/mo** |

At $19/mo per Pro user, we need exactly 1 paying user to cover AI costs with 11x margin.

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Grants.gov API goes down | Daily sync is non-critical; grants from yesterday still valid. Log and retry next day. |
| LLM classification hallucinates tags | Tags are supplementary to keyword matching, not replacing it. Bad tags reduce relevance but don't create false positives (category hard filter still applies). |
| `portal_id` column removal breaks existing code | Don't remove it. Keep nullable, add `source_id` alongside. Migrate CA sync to use both. |
| Supabase free tier limits (500MB, 50K rows) | ~5,000 grants at ~1KB each = ~5MB. Plus raw_json adds ~10x. Still well under 500MB. Monitor. |
| Digest double-send on cron retry | Dedup key `(org_id, digest_week)` prevents duplicate sends. |
| DB errors hidden as "no matches" | `matchGrantsForOrg` must throw on Supabase error, not return `[]`. Digest sender catches and logs as failure. |
| Stale federal grants accumulate | Reconciliation step marks missing grants as closed each sync cycle. |
| Rate limiting on search2 | No documented limits. Paginate at 250/page with 500ms delay between pages. ~12 requests total for full catalog. |

---

## 8. Success Criteria

- [ ] Federal sync runs daily on cron, ingests ~2,800 grants with diff detection
- [ ] `/grants` command surfaces relevant preservation grants from both sources
- [ ] LLM classification generates useful tags (manual spot-check of 20 grants)
- [ ] Matching engine uses AI tags — digest relevance improves (qualitative check)
- [ ] No increase in digest email cost (classification runs outside digest send)
- [ ] Pro fit score works on `/grants/[id]` page (for when first Pro user signs up)
