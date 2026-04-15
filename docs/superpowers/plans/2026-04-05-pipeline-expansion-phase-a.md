# Pipeline Expansion Phase A: Hotfix + Schema + Federal Ingestor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix live data corruption, migrate to multi-source schema, and rewrite the federal grant ingestor with diff detection, detail fetching, and safe reconciliation.

**Architecture:** Supabase Postgres backend with Next.js API routes on Vercel. Migration adds `source_id` composite key (replaces negative `portal_id` hack), two-phase payload hashing for diff detection, and structured columns for LLM classification. Federal sync switches from legacy `apply07.grants.gov` to current REST API at `api.grants.gov`.

**Tech Stack:** Next.js 16, Supabase (Postgres), Vercel cron, Grants.gov REST API (unauthenticated)

**Spec:** `docs/superpowers/specs/2026-04-05-grant-pipeline-expansion-design.md`

---

### Task 0: HOTFIX — Fix CA sync closing federal grants

**Files:**
- Modify: `src/lib/grants.ts:117-125`

This is the live data corruption bug. The CA sync marks ALL active grants not in the CA CSV as closed — including federal grants. Deploy immediately.

- [ ] **Step 1: Add source filter to close query**

In `src/lib/grants.ts`, change line 118-121 from:

```typescript
  const { data: existingGrants } = await supabase
    .from("grants")
    .select("id, portal_id")
    .in("status", ["active", "forecasted"]);
```

to:

```typescript
  const { data: existingGrants } = await supabase
    .from("grants")
    .select("id, portal_id")
    .in("status", ["active", "forecasted"])
    .eq("source", "ca_portal");
```

- [ ] **Step 2: Verify the fix locally**

Run: `npx next build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit and deploy**

```bash
git add src/lib/grants.ts
git commit -m "fix: scope CA sync close logic to ca_portal source only

The close step was marking ALL active grants not in the CA CSV as closed,
including federal grants. Now only closes ca_portal-sourced grants.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: Fix digest sender — error isolation + single grant fetch + response accuracy

**Files:**
- Modify: `src/app/api/send-digests/route.ts`
- Modify: `src/lib/matching.ts:83-89`

- [ ] **Step 1: Fix matchGrantsForOrg to throw on DB error**

In `src/lib/matching.ts`, change line 84-89 from:

```typescript
  const { data: grants, error } = await supabase
    .from("grants")
    .select("*")
    .in("status", ["active", "forecasted"]);

  if (error || !grants) return [];
```

to:

```typescript
  const { data: grants, error } = await supabase
    .from("grants")
    .select("*")
    .in("status", ["active", "forecasted"]);

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }
  if (!grants) return [];
```

- [ ] **Step 2: Accept pre-fetched grants in matchGrantsForOrg**

Change the function signature to accept optional pre-fetched grants. In `src/lib/matching.ts`, change line 83:

```typescript
export async function matchGrantsForOrg(org: Organization): Promise<MatchedGrant[]> {
```

to:

```typescript
export async function matchGrantsForOrg(
  org: Organization,
  prefetchedGrants?: Grant[]
): Promise<MatchedGrant[]> {
```

Then change the grant fetch to use prefetched data if provided:

```typescript
  let allGrants: Grant[];
  if (prefetchedGrants) {
    allGrants = prefetchedGrants;
  } else {
    const { data: grants, error } = await supabase
      .from("grants")
      .select("*")
      .in("status", ["active", "forecasted"]);

    if (error) {
      throw new Error(`Supabase query failed: ${error.message}`);
    }
    allGrants = (grants || []) as Grant[];
  }
```

Update the loop at line 97 to use `allGrants` instead of `grants as Grant[]`.

- [ ] **Step 3: Rewrite digest sender with error isolation and single fetch**

Replace the entire contents of `src/app/api/send-digests/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { matchGrantsForOrg } from "@/lib/matching";
import { sendDigestEmail } from "@/lib/email";

export const maxDuration = 120;

interface DigestResult {
  org: string;
  status: "sent" | "skipped_empty" | "send_failed" | "match_error";
  grants: number;
  error?: string;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all verified, non-cancelled orgs
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("email_verified", true)
    .not("subscription_status", "eq", "cancelled");

  if (orgError || !orgs) {
    return NextResponse.json({ error: orgError?.message || "No orgs" }, { status: 500 });
  }

  // Fetch ALL active grants ONCE (not per org). Exclude raw_json to save memory.
  const { data: allGrants, error: grantsError } = await supabase
    .from("grants")
    .select("id, portal_id, source, source_id, status, title, agency, purpose, description, synopsis, eligibility, categories, applicant_types, geography_text, est_amounts_text, application_deadline, deadline_date, open_date, grant_url, contact_info, first_seen_at, ai_tags, ai_summary")
    .in("status", ["active", "forecasted"]);

  if (grantsError) {
    return NextResponse.json({ error: `Grant fetch failed: ${grantsError.message}` }, { status: 500 });
  }

  const results: DigestResult[] = [];
  // Compute current digest week (ISO week) for dedup
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  const digestWeek = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      // Dedup check: skip if already sent this week
      const { data: existing } = await supabase
        .from("digests")
        .select("id")
        .eq("org_id", org.id)
        .eq("digest_week", digestWeek)
        .limit(1);

      if (existing && existing.length > 0) {
        results.push({ org: org.name, status: "skipped_empty", grants: 0 });
        skipped++;
        continue;
      }
      const matched = await matchGrantsForOrg(
        {
          id: org.id,
          categories: org.categories,
          geography_keywords: org.geography_keywords,
          mission_keywords: org.mission_keywords || [],
          min_grant_amount: org.min_grant_amount || null,
        },
        allGrants || []
      );

      if (matched.length === 0) {
        results.push({ org: org.name, status: "skipped_empty", grants: 0 });
        skipped++;
        continue;
      }

      const showUpgrade = org.tier === "free";
      const emailResult = await sendDigestEmail(
        org.email, org.name, matched, org.unsubscribe_token, showUpgrade
      );

      if (emailResult) {
        await supabase.from("digests").insert({
          org_id: org.id,
          grant_count: matched.length,
          resend_message_id: emailResult.id,
          digest_week: digestWeek,
        });
        results.push({ org: org.name, status: "sent", grants: matched.length });
        sent++;
      } else {
        results.push({ org: org.name, status: "send_failed", grants: matched.length });
        failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`Digest failed for ${org.name}: ${message}`);
      results.push({ org: org.name, status: "match_error", grants: 0, error: message });
      failed++;
    }
  }

  return NextResponse.json({ sent, skipped, failed, total: orgs.length, results });
}
```

- [ ] **Step 4: Build and verify**

Run: `npx next build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/matching.ts src/app/api/send-digests/route.ts
git commit -m "fix: digest sender error isolation, single grant fetch, accurate response

- matchGrantsForOrg now throws on DB error instead of returning []
- matchGrantsForOrg accepts optional prefetched grants (avoids N full-table scans)
- Digest sender wraps each org in try/catch
- Response returns { sent, skipped, failed } instead of misleading total

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Write migration 005_pipeline_expansion.sql

**Files:**
- Create: `supabase/migrations/005_pipeline_expansion.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/005_pipeline_expansion.sql`:

```sql
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
```

- [ ] **Step 2: Apply migration to Supabase**

Run: `npx supabase db push` or apply via Supabase dashboard SQL editor.
Expected: Migration applies cleanly.

- [ ] **Step 3: Verify migration**

Run this SQL in Supabase SQL editor:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'grants' AND column_name IN ('source_id', 'search_hash', 'detail_hash', 'ai_tags', 'cfda_numbers', 'last_seen_in_sync')
ORDER BY column_name;
```
Expected: All 6 columns exist.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/005_pipeline_expansion.sql
git commit -m "feat: add migration 005 — multi-source schema, AI columns, digest dedup

- source_id + unique(source, source_id) replaces portal_id as dedup key
- portal_id now nullable (kept for CA backward compat)
- search_hash + detail_hash for two-phase diff detection
- synopsis, eligibility, award_floor, award_ceiling from detail fetch
- ai_tags, ai_summary, ai_classified_at for LLM classification
- cfda_numbers for structured CFDA monitoring
- last_seen_in_sync for safe reconciliation
- digest_week + unique(org_id, digest_week) for idempotent sends

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Update CA sync to populate source_id

**Files:**
- Modify: `src/lib/grants.ts`

- [ ] **Step 1: Add source_id to CA grant upsert payload**

In `src/lib/grants.ts`, find the `csvRowToGrant` function (or the object construction that maps CSV rows to grant objects). Add `source_id` to the returned object:

```typescript
    source_id: row.PortalID,
```

This goes right next to the existing `portal_id` and `source` fields.

- [ ] **Step 2: Update upsert to use new composite key**

Change the upsert `onConflict` from `"portal_id"` to `"source,source_id"`:

In `src/lib/grants.ts` line 107-109, change:

```typescript
    const { error } = await supabase.from("grants").upsert(batch, {
      onConflict: "portal_id",
      ignoreDuplicates: false,
    });
```

to:

```typescript
    const { error } = await supabase.from("grants").upsert(batch, {
      onConflict: "source,source_id",
      ignoreDuplicates: false,
    });
```

- [ ] **Step 3: Build and verify**

Run: `npx next build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/grants.ts
git commit -m "feat: CA sync populates source_id, upserts on (source, source_id)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rewrite federal sync with correct API, diff detection, and detail fetching

**Files:**
- Rewrite: `src/app/api/sync-federal/route.ts`
- Create: `src/lib/grants-gov.ts` (API client + hashing logic)

This is the biggest task. The existing sync-federal is a ~175 line monolith. We're splitting into a clean API client + the route handler.

- [ ] **Step 1: Create Grants.gov API client**

Create `src/lib/grants-gov.ts`:

```typescript
import { createHash } from "crypto";

const GRANTS_GOV_BASE = "https://api.grants.gov";
const SEARCH_URL = `${GRANTS_GOV_BASE}/v1/api/search2`;
const DETAIL_URL = `${GRANTS_GOV_BASE}/v1/api/fetchOpportunity`;

interface SearchHit {
  id: number;
  number: string;
  title: string;
  agency: string;
  openDate: string;
  closeDate: string;
  awardCeiling: number;
  awardFloor: number;
  oppStatus: string;
  cfdaList: string[];
  fundingCategories: string[];
  [key: string]: unknown;
}

interface OpportunityDetail {
  synopsis: { synopsisDesc: string } | null;
  forecast: { synopsisDesc: string } | null;
  applicantTypes: Array<{ code: string; description: string }>;
  cfdaNumbers: Array<{ programTitle: string; cfdaNumber: string }>;
  [key: string]: unknown;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error("fetchWithRetry exhausted retries");
}

export async function searchOpportunities(): Promise<SearchHit[]> {
  const allHits: SearchHit[] = [];
  let startRecord = 0;
  const pageSize = 250;

  while (true) {
    const res = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oppStatuses: "posted",
        rows: pageSize,
        startRecordNum: startRecord,
      }),
    });

    const data = await res.json();
    const hits: SearchHit[] = data.oppHits || [];
    allHits.push(...hits);

    if (hits.length < pageSize) break;
    startRecord += pageSize;

    // 500ms delay between pages to be respectful
    await new Promise((r) => setTimeout(r, 500));
  }

  return allHits;
}

export async function fetchOpportunityDetail(
  oppId: number
): Promise<OpportunityDetail | null> {
  try {
    const res = await fetchWithRetry(
      `${DETAIL_URL}/${oppId}`,
      { method: "GET" }
    );
    return await res.json();
  } catch {
    return null;
  }
}

export function computeSearchHash(hit: SearchHit): string {
  const normalized = JSON.stringify({
    title: hit.title || "",
    closeDate: hit.closeDate || "",
    awardCeiling: hit.awardCeiling || 0,
    awardFloor: hit.awardFloor || 0,
    fundingCategories: (hit.fundingCategories || []).sort(),
    oppStatus: hit.oppStatus || "",
  });
  return createHash("sha256").update(normalized).digest("hex");
}

export function computeDetailHash(
  hit: SearchHit,
  detail: OpportunityDetail
): string {
  const synopsis =
    detail.synopsis?.synopsisDesc || detail.forecast?.synopsisDesc || "";
  const eligibility = (detail.applicantTypes || [])
    .map((a) => a.description)
    .sort()
    .join(", ");
  const normalized = JSON.stringify({
    title: hit.title || "",
    closeDate: hit.closeDate || "",
    awardCeiling: hit.awardCeiling || 0,
    awardFloor: hit.awardFloor || 0,
    fundingCategories: (hit.fundingCategories || []).sort(),
    oppStatus: hit.oppStatus || "",
    synopsis,
    eligibility,
  });
  return createHash("sha256").update(normalized).digest("hex");
}

function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

export function transformHit(hit: SearchHit, detail: OpportunityDetail | null) {
  const synopsis =
    detail?.synopsis?.synopsisDesc || detail?.forecast?.synopsisDesc || null;
  const applicantTypes = detail?.applicantTypes
    ? detail.applicantTypes.map((a) => a.description)
    : [];
  const cfdaNumbers = detail?.cfdaNumbers
    ? detail.cfdaNumbers.map((c) => c.cfdaNumber)
    : hit.cfdaList || [];

  return {
    source: "grants_gov",
    source_id: String(hit.id),
    portal_id: null,
    grant_id: hit.number || null,
    status: "active",
    agency: hit.agency || null,
    title: hit.title || "Untitled",
    purpose: null,
    description: null,
    synopsis,
    eligibility: applicantTypes.join(", ") || null,
    categories: mapCategories(hit.cfdaList || [], hit.fundingCategories || []),
    applicant_types: applicantTypes.length > 0 ? applicantTypes : ["Unknown"],
    geography_text: "Nationwide",
    est_amounts_text: hit.awardCeiling
      ? `Up to $${Number(hit.awardCeiling).toLocaleString()}`
      : null,
    award_floor: hit.awardFloor || null,
    award_ceiling: hit.awardCeiling || null,
    application_deadline: hit.closeDate || null,
    deadline_date: parseDate(hit.closeDate || null),
    open_date: parseDate(hit.openDate || null),
    grant_url: `https://www.grants.gov/search-results-detail/${hit.id}`,
    contact_info: null,
    cfda_numbers: cfdaNumbers,
    search_hash: computeSearchHash(hit),
    detail_hash: detail ? computeDetailHash(hit, detail) : null,
    detail_fetched: !!detail,
    detail_fetched_at: detail ? new Date().toISOString() : null,
    raw_json: hit,
    last_seen_in_sync: new Date().toISOString(),
  };
}

// Copied from existing sync-federal — category mapping from CFDA codes
const CFDA_TO_CATEGORIES: Record<string, string[]> = {
  AG: ["Agriculture"],
  AR: ["Libraries and Arts"],
  BC: ["Consumer Protection"],
  CD: ["Housing, Community and Economic Development"],
  CP: ["Consumer Protection"],
  DPR: ["Disaster Prevention & Relief"],
  ED: ["Education"],
  ELT: ["Employment, Labor & Training"],
  EN: ["Energy"],
  ENV: ["Environment & Water"],
  FN: ["Food & Nutrition"],
  HL: ["Health & Human Services"],
  HO: ["Housing, Community and Economic Development"],
  HU: ["Libraries and Arts"],
  IS: ["Science, Technology, and Research & Development"],
  LJL: ["Law, Justice, and Legal Services"],
  NR: ["Environment & Water"],
  O: ["Consumer Protection"],
  RA: ["Science, Technology, and Research & Development"],
  RD: ["Housing, Community and Economic Development"],
  ST: ["Science, Technology, and Research & Development"],
  T: ["Transportation"],
};

function mapCategories(cfdaList: string[], fundingCategories: string[]): string[] {
  const cats = new Set<string>();
  for (const fc of fundingCategories) {
    const mapped = CFDA_TO_CATEGORIES[fc];
    if (mapped) mapped.forEach((c) => cats.add(c));
  }
  if (cats.size === 0 && cfdaList.length > 0) {
    for (const cfda of cfdaList) {
      const prefix = cfda.split(".")[0];
      const agencyMap: Record<string, string[]> = {
        "10": ["Agriculture"],
        "14": ["Housing, Community and Economic Development"],
        "15": ["Parks & Recreation", "Libraries and Arts"],
        "16": ["Law, Justice, and Legal Services"],
        "17": ["Employment, Labor & Training"],
        "20": ["Transportation"],
        "45": ["Libraries and Arts"],
        "47": ["Science, Technology, and Research & Development"],
        "59": ["Housing, Community and Economic Development"],
        "66": ["Environment & Water"],
        "81": ["Energy"],
        "84": ["Education"],
        "93": ["Health & Human Services"],
        "97": ["Disaster Prevention & Relief"],
      };
      const mapped = agencyMap[prefix];
      if (mapped) mapped.forEach((c) => cats.add(c));
    }
  }
  return cats.size > 0 ? [...cats] : ["Consumer Protection"];
}
```

- [ ] **Step 2: Rewrite the sync-federal route handler**

Replace `src/app/api/sync-federal/route.ts` entirely:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  searchOpportunities,
  fetchOpportunityDetail,
  computeSearchHash,
  transformHit,
} from "@/lib/grants-gov";

export const maxDuration = 300;

const MIN_RESULTS_SAFETY = 500; // skip reconciliation if fewer than this

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Fetch all posted opportunities from Grants.gov
    const allHits = await searchOpportunities();

    if (allHits.length === 0) {
      return NextResponse.json(
        { error: "No grants fetched — API may be down", fetched: 0 },
        { status: 500 }
      );
    }

    // 2. Load existing search hashes for diff detection
    const { data: existing } = await supabase
      .from("grants")
      .select("source_id, search_hash")
      .eq("source", "grants_gov");

    const existingHashes = new Map(
      (existing || []).map((g) => [g.source_id, g.search_hash])
    );

    // 3. Identify new or changed grants
    const newOrChanged = allHits.filter((hit) => {
      const sourceId = String(hit.id);
      const currentHash = computeSearchHash(hit);
      const storedHash = existingHashes.get(sourceId);
      return !storedHash || storedHash !== currentHash;
    });

    // 4. Fetch details for new/changed grants only
    let detailsFetched = 0;
    const grantsToUpsert = [];

    for (const hit of allHits) {
      const sourceId = String(hit.id);
      const isNewOrChanged = newOrChanged.some((h) => String(h.id) === sourceId);

      let detail = null;
      if (isNewOrChanged && detailsFetched < 200) {
        // Cap detail fetches per run to avoid rate limiting.
        // First run: ~200 details per invocation. Run curl multiple times to backfill.
        detail = await fetchOpportunityDetail(hit.id);
        if (detail) detailsFetched++;
        // 200ms delay between detail fetches to avoid IP ban
        await new Promise((r) => setTimeout(r, 200));
      }

      grantsToUpsert.push(transformHit(hit, isNewOrChanged ? detail : null));
    }

    // 5. Upsert in batches
    let upserted = 0;
    const errors: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < grantsToUpsert.length; i += batchSize) {
      const batch = grantsToUpsert.slice(i, i + batchSize);
      const { error } = await supabase
        .from("grants")
        .upsert(batch, { onConflict: "source,source_id" });
      if (error) {
        errors.push(`Batch ${i}: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }

    // 6. Reconciliation: close stale federal grants
    let closed = 0;
    if (allHits.length >= MIN_RESULTS_SAFETY) {
      const threeDaysAgo = new Date(
        Date.now() - 3 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: stale } = await supabase
        .from("grants")
        .select("id")
        .eq("source", "grants_gov")
        .eq("status", "active")
        .lt("last_seen_in_sync", threeDaysAgo);

      if (stale && stale.length > 0) {
        const staleIds = stale.map((g) => g.id);
        const { error: closeError } = await supabase
          .from("grants")
          .update({ status: "closed" })
          .in("id", staleIds);
        if (!closeError) closed = staleIds.length;
      }
    } else {
      console.warn(
        `Federal sync: only ${allHits.length} results (< ${MIN_RESULTS_SAFETY}). Skipping reconciliation.`
      );
    }

    return NextResponse.json({
      source: "grants_gov",
      fetched: allHits.length,
      new_or_changed: newOrChanged.length,
      details_fetched: detailsFetched,
      upserted,
      closed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Federal sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Build and verify**

Run: `npx next build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/grants-gov.ts src/app/api/sync-federal/route.ts
git commit -m "feat: rewrite federal sync — correct API, diff detection, detail fetching

- Switch from legacy apply07.grants.gov to api.grants.gov REST API
- Two-phase hashing: search_hash detects changes, detail_hash tracks full content
- fetchOpportunity for new/changed grants only (~10-50/day vs 2,800)
- Exponential backoff with 3 retries
- Safe reconciliation: 3-day buffer + MIN_RESULTS_SAFETY guard
- Real applicant_types from API (not hardcoded Nonprofit)
- Structured cfda_numbers column
- raw_json stored for replay
- maxDuration 300s (was 60s)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add ai_tags to matching engine

**Files:**
- Modify: `src/lib/matching.ts`

- [ ] **Step 1: Add ai_tags to Grant interface**

In `src/lib/matching.ts`, add to the `Grant` interface (around line 14):

```typescript
  ai_tags: string[] | null;
```

- [ ] **Step 2: Add ai_tags scoring to scoreRelevance**

In `src/lib/matching.ts`, in the `scoreRelevance` function, after the existing keyword loop (around line 78), add:

```typescript
  // Score against AI-generated tags
  if ((grant as { ai_tags?: string[] | null }).ai_tags) {
    const aiTags = (grant as { ai_tags?: string[] | null }).ai_tags!;
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (aiTags.some((tag) => tag.toLowerCase().includes(kwLower))) {
        score += 40;
        reasons.push(`"${kw}" in AI tags`);
      }
    }
  }
```

- [ ] **Step 3: Build and verify**

Run: `npx next build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/matching.ts
git commit -m "feat: matching engine scores against ai_tags (+40 per keyword match)

AI tags augment existing keyword matching. A grant might not mention
'historic preservation' in title but could have it as an AI tag
from synopsis analysis.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Add federal sync to Vercel cron + update architecture docs

**Files:**
- Modify: `vercel.json`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Add federal sync cron**

In `vercel.json`, add the federal sync to the crons array:

```json
{
  "crons": [
    {
      "path": "/api/sync-grants",
      "schedule": "0 13 * * *"
    },
    {
      "path": "/api/sync-federal",
      "schedule": "0 14 * * *"
    },
    {
      "path": "/api/send-digests",
      "schedule": "50 14 * * 1"
    }
  ]
}
```

- [ ] **Step 2: Update architecture.md**

Update the Current State table in `docs/architecture.md` to reflect multi-source:

```markdown
| Metric | Value |
|--------|-------|
| Data sources | CA Grants Portal + Grants.gov |
| Active grants | ~160 CA + ~2,800 federal |
| Total grants in DB | ~4,700+ |
| Orgs signed up | 1 (test) |
| Revenue | $0 |
| Pro tier | Stub (coming soon badge) |
| AI features | AI tag classification (via Claude Code) |
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json docs/architecture.md
git commit -m "feat: add federal sync daily cron, update architecture docs

Federal sync runs at 2PM UTC (6AM PT), 1 hour after CA sync.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Deploy and run initial federal sync

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Verify Vercel deployment succeeds**

Check Vercel dashboard or run `vercel ls` to confirm deployment.

- [ ] **Step 3: Run initial federal sync manually**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://grantradar-sable.vercel.app/api/sync-federal
```

Expected: JSON response with `fetched: ~2800`, `new_or_changed: ~2800` (first run), `details_fetched: 200` (capped per run), `upserted: ~2800`.

Note: Detail fetches are capped at 200 per invocation to avoid rate limiting. Run the curl command ~14 times to backfill all ~2800 grants. Each run takes ~1 minute. Use `curl --max-time 600`.

```bash
# Run until details_fetched returns 0 (all grants hydrated)
for i in $(seq 1 15); do
  echo "Run $i..."
  curl --max-time 600 -H "Authorization: Bearer $CRON_SECRET" https://grantradar-sable.vercel.app/api/sync-federal
  echo ""
  sleep 5
done
```

- [ ] **Step 4: Verify data in Supabase**

Run in Supabase SQL editor:
```sql
SELECT source, count(*), count(detail_fetched) FILTER (WHERE detail_fetched)
FROM grants
GROUP BY source;
```

Expected: `grants_gov` rows with `~2800` count, most with `detail_fetched = true`.

---

## Phase A Complete

After Task 7, GrantRadar has:
- Live data corruption bug fixed
- Digest sender with error isolation
- Multi-source schema with composite dedup key
- Smart federal ingestor with diff detection and detail fetching
- Daily cron for both CA and federal syncs
- AI classification columns ready for Phase B

Phase B (Claude Code `/grants` skill) can now run against the production database.
