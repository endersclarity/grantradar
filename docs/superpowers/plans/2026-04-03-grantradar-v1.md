# GrantRadar V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a weekly email digest that matches CA state grants to small nonprofits based on their sector and geography, with Stripe billing after a 2-digest free trial.

**Architecture:** Next.js 16 App Router with API routes for cron jobs and webhooks. Supabase Postgres for data. Resend for email. Stripe for payments. Daily cron syncs grants from CA data portal CSV. Weekly Monday cron sends matched digests.

**Tech Stack:** Next.js 16, React 19, Supabase (Postgres + JS client), Resend, Stripe, Vercel (hosting + cron), Tailwind CSS, shadcn/ui

**Design Doc:** `~/.gstack/projects/zenvoice/ender-main-design-20260403-170500.md`

**Critical fixes from adversarial review (must be incorporated):**
1. Add `first_seen_at` timestamp to Grant model — use this for "NEW THIS WEEK", not `last_synced` (which updates daily for ALL grants)
2. Trial logic: trial orgs get exactly 2 digests. The 3rd send includes an upgrade banner and sets status to `expired`. No off-by-one.
3. Empty digest: if matching returns 0 grants, skip sending. Do NOT increment `trial_digests_sent`.
4. CSV sync safety: only mark grants as closed if the CSV fetch returned >= 50 rows (guards against network failure wiping the table)

---

## File Structure

```
grantradar/
├── src/
│   ├── app/
│   │   ├── layout.tsx              — Root layout (fonts, metadata, global styles)
│   │   ├── page.tsx                — Landing page with signup form
│   │   ├── globals.css             — Tailwind + shadcn theme
│   │   ├── unsubscribe/
│   │   │   └── page.tsx            — Token-based unsubscribe page
│   │   ├── settings/
│   │   │   └── page.tsx            — Token-based settings page (update categories/geo)
│   │   └── api/
│   │       ├── signup/
│   │       │   └── route.ts        — POST: create org, send confirmation email
│   │       ├── sync-grants/
│   │       │   └── route.ts        — GET: daily cron, fetch CSV, upsert grants
│   │       ├── send-digests/
│   │       │   └── route.ts        — GET: weekly cron, match + send emails
│   │       ├── settings/
│   │       │   └── route.ts        — POST: update org categories/geography
│   │       └── webhooks/
│   │           └── stripe/
│   │               └── route.ts    — POST: Stripe webhook handler
│   ├── lib/
│   │   ├── supabase.ts             — Supabase client singleton
│   │   ├── grants.ts               — CSV fetch, parse, upsert logic
│   │   ├── matching.ts             — Grant-to-org matching logic
│   │   ├── email.ts                — Resend client + email rendering
│   │   └── constants.ts            — Category enum, config values
│   └── components/
│       ├── signup-form.tsx          — Client component: signup form
│       └── ui/                     — shadcn components (button, input, select, etc.)
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  — Organizations, Grants, Digests tables
├── package.json
├── .env.local.example              — Required env vars template
├── vercel.json                     — Cron job configuration
└── next.config.ts
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `grantradar/` (new Next.js project)
- Create: `.env.local.example`
- Create: `vercel.json`
- Create: `src/lib/constants.ts`

- [ ] **Step 1: Create Next.js project**

```bash
cd /Users/ender/code
npx create-next-app@latest grantradar --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm
```

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/ender/code/grantradar
pnpm add @supabase/supabase-js resend stripe csv-parse
npx shadcn@latest init -d
npx shadcn@latest add button input label card badge select separator -y
```

- [ ] **Step 3: Create constants file**

Create `src/lib/constants.ts`:

```typescript
export const GRANT_CATEGORIES = [
  "Agriculture",
  "Animal Services",
  "Consumer Protection",
  "Disadvantaged Communities",
  "Disaster Prevention & Relief",
  "Education",
  "Employment, Labor & Training",
  "Energy",
  "Environment & Water",
  "Food & Nutrition",
  "Health & Human Services",
  "Housing, Community and Economic Development",
  "Law, Justice, and Legal Services",
  "Libraries and Arts",
  "Parks & Recreation",
  "Science, Technology, and Research & Development",
  "Transportation",
  "Veterans & Military",
] as const;

export type GrantCategory = (typeof GRANT_CATEGORIES)[number];

export const CA_GRANTS_CSV_URL =
  "https://data.ca.gov/dataset/e1b1c799-cdd4-4219-af6d-93b79747fffb/resource/111c8c88-21f6-453c-ae2c-b4785a0624f5/download/california-grants-portal-data.csv";

export const TRIAL_DIGEST_LIMIT = 2;
export const MIN_CSV_ROWS_SAFETY = 50;
```

- [ ] **Step 4: Create env template**

Create `.env.local.example`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
RESEND_API_KEY=re_your_key
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_secret
STRIPE_PRICE_ID=price_your_price_id
CRON_SECRET=your-random-secret
BASE_URL=http://localhost:3000
```

- [ ] **Step 5: Create vercel.json with cron config**

Create `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/sync-grants",
      "schedule": "0 13 * * *"
    },
    {
      "path": "/api/send-digests",
      "schedule": "50 14 * * 1"
    }
  ]
}
```

Note: `0 13 * * *` = 6am PT (PDT, UTC-7). `50 14 * * 1` = 7:50am PT Monday. These shift by 1 hour when DST changes. Acceptable for v1.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold grantradar project with deps and config"
```

---

### Task 2: Database Schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`
- Create: `src/lib/supabase.ts`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/001_initial_schema.sql`:

```sql
-- Organizations: nonprofits that receive weekly grant digests
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  categories text[] not null default '{}',
  geography_keywords text[] not null default '{}',
  applicant_type text not null default 'Nonprofit',
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'cancelled', 'expired')),
  trial_digests_sent int not null default 0,
  stripe_customer_id text,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create unique index idx_organizations_unsubscribe_token on organizations (unsubscribe_token);
create index idx_organizations_status on organizations (subscription_status);

-- Grants: synced daily from CA Grants Portal CSV
create table grants (
  id uuid primary key default gen_random_uuid(),
  portal_id int not null unique,
  grant_id text,
  status text not null default 'active',
  agency text,
  title text not null,
  purpose text,
  description text,
  categories text[] not null default '{}',
  applicant_types text[] not null default '{}',
  geography_text text,
  est_amounts_text text,
  est_available_funds_text text,
  application_deadline text,
  deadline_date date,
  open_date date,
  grant_url text,
  contact_info text,
  first_seen_at timestamptz not null default now(),
  last_synced timestamptz not null default now()
);

create index idx_grants_status on grants (status);
create index idx_grants_deadline on grants (deadline_date);
create index idx_grants_first_seen on grants (first_seen_at);

-- Digests: log of sent emails
create table digests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sent_at timestamptz not null default now(),
  grant_count int not null default 0,
  resend_message_id text
);

create index idx_digests_org on digests (org_id);
```

- [ ] **Step 2: Create Supabase client**

Create `src/lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
```

- [ ] **Step 3: Apply migration to Supabase**

Run the migration via the Supabase dashboard SQL editor, or via CLI:

```bash
npx supabase db push
```

(Requires Supabase CLI linked to a project. If no project exists yet, create one at supabase.com first.)

- [ ] **Step 4: Commit**

```bash
git add supabase/ src/lib/supabase.ts
git commit -m "feat: add database schema and supabase client"
```

---

### Task 3: Grant Sync (CSV Fetch + Parse + Upsert)

**Files:**
- Create: `src/lib/grants.ts`
- Create: `src/app/api/sync-grants/route.ts`

- [ ] **Step 1: Write CSV fetch and parse logic**

Create `src/lib/grants.ts`:

```typescript
import { parse } from "csv-parse/sync";
import { supabase } from "./supabase";
import { CA_GRANTS_CSV_URL, MIN_CSV_ROWS_SAFETY } from "./constants";

interface CsvRow {
  PortalID: string;
  GrantID: string;
  Status: string;
  AgencyDept: string;
  Title: string;
  Purpose: string;
  Description: string;
  Categories: string;
  ApplicantType: string;
  Geography: string;
  EstAmounts: string;
  EstAvailFunds: string;
  ApplicationDeadline: string;
  OpenDate: string;
  GrantURL: string;
  ContactInfo: string;
}

function parseSemicolonList(value: string): string[] {
  if (!value) return [];
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDateLoose(value: string): string | null {
  if (!value || value.toLowerCase() === "ongoing") return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
  } catch {
    return null;
  }
}

function csvRowToGrant(row: CsvRow) {
  return {
    portal_id: parseInt(row.PortalID, 10),
    grant_id: row.GrantID || null,
    status: row.Status?.toLowerCase() || "active",
    agency: row.AgencyDept || null,
    title: row.Title || "Untitled",
    purpose: row.Purpose || null,
    description: row.Description || null,
    categories: parseSemicolonList(row.Categories),
    applicant_types: parseSemicolonList(row.ApplicantType),
    geography_text: row.Geography || null,
    est_amounts_text: row.EstAmounts || null,
    est_available_funds_text: row.EstAvailFunds || null,
    application_deadline: row.ApplicationDeadline || null,
    deadline_date: parseDateLoose(row.ApplicationDeadline),
    open_date: parseDateLoose(row.OpenDate),
    grant_url: row.GrantURL || null,
    contact_info: row.ContactInfo || null,
    last_synced: new Date().toISOString(),
  };
}

export async function syncGrants(): Promise<{
  fetched: number;
  upserted: number;
  closed: number;
  error?: string;
}> {
  // Fetch CSV
  const response = await fetch(CA_GRANTS_CSV_URL);
  if (!response.ok) {
    return { fetched: 0, upserted: 0, closed: 0, error: `CSV fetch failed: ${response.status}` };
  }

  const csvText = await response.text();
  const rows: CsvRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });

  // Safety guard: if CSV returned too few rows, something is wrong. Don't nuke the table.
  if (rows.length < MIN_CSV_ROWS_SAFETY) {
    return {
      fetched: rows.length,
      upserted: 0,
      closed: 0,
      error: `CSV returned only ${rows.length} rows (minimum ${MIN_CSV_ROWS_SAFETY}). Aborting to prevent data loss.`,
    };
  }

  // Collect portal_ids from CSV
  const csvPortalIds = new Set<number>();
  const grantsToUpsert = rows.map((row) => {
    const grant = csvRowToGrant(row);
    csvPortalIds.add(grant.portal_id);
    return grant;
  });

  // Upsert grants in batches of 500
  let upserted = 0;
  for (let i = 0; i < grantsToUpsert.length; i += 500) {
    const batch = grantsToUpsert.slice(i, i + 500);
    const { error } = await supabase.from("grants").upsert(batch, {
      onConflict: "portal_id",
      ignoreDuplicates: false,
    });
    if (error) {
      return { fetched: rows.length, upserted, closed: 0, error: `Upsert error: ${error.message}` };
    }
    upserted += batch.length;
  }

  // Mark grants not in CSV as closed (only those currently active/forecasted)
  // Note: first_seen_at is NOT updated on upsert (it has a default, not an upsert value)
  const { data: existingGrants } = await supabase
    .from("grants")
    .select("id, portal_id")
    .in("status", ["active", "forecasted"]);

  const toClose = (existingGrants || [])
    .filter((g) => !csvPortalIds.has(g.portal_id))
    .map((g) => g.id);

  let closed = 0;
  if (toClose.length > 0) {
    const { error } = await supabase
      .from("grants")
      .update({ status: "closed", last_synced: new Date().toISOString() })
      .in("id", toClose);
    if (!error) closed = toClose.length;
  }

  return { fetched: rows.length, upserted, closed };
}
```

- [ ] **Step 2: Write the sync API route**

Create `src/app/api/sync-grants/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { syncGrants } from "@/lib/grants";

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncGrants();

  if (result.error) {
    console.error("Grant sync error:", result.error);
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
```

- [ ] **Step 3: Test locally**

```bash
# Set env vars in .env.local first, then:
curl http://localhost:3000/api/sync-grants -H "Authorization: Bearer $CRON_SECRET"
```

Expected: JSON with `fetched: ~1874, upserted: ~1874, closed: 0`

- [ ] **Step 4: Commit**

```bash
git add src/lib/grants.ts src/app/api/sync-grants/route.ts
git commit -m "feat: add grant sync from CA Grants Portal CSV"
```

---

### Task 4: Matching Logic

**Files:**
- Create: `src/lib/matching.ts`

- [ ] **Step 1: Write matching function**

Create `src/lib/matching.ts`:

```typescript
import { supabase } from "./supabase";

interface Organization {
  id: string;
  categories: string[];
  geography_keywords: string[];
}

interface Grant {
  id: string;
  portal_id: number;
  status: string;
  title: string;
  agency: string;
  purpose: string;
  categories: string[];
  applicant_types: string[];
  geography_text: string | null;
  est_amounts_text: string | null;
  application_deadline: string | null;
  deadline_date: string | null;
  grant_url: string | null;
  first_seen_at: string;
}

export interface MatchedGrant extends Grant {
  section: "closing_soon" | "new_this_week" | "all_matching";
}

function hasOverlap(a: string[], b: string[]): boolean {
  const setB = new Set(b.map((s) => s.toLowerCase()));
  return a.some((item) => setB.has(item.toLowerCase()));
}

function matchesGeography(geoText: string | null, keywords: string[]): boolean {
  if (!geoText || geoText.trim() === "") return true; // include if empty
  const lower = geoText.toLowerCase();
  if (lower.includes("statewide") || lower.includes("california")) return true;
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export async function matchGrantsForOrg(org: Organization): Promise<MatchedGrant[]> {
  // Fetch active/forecasted grants that include "Nonprofit" in applicant_types
  const { data: grants, error } = await supabase
    .from("grants")
    .select("*")
    .in("status", ["active", "forecasted"])
    .contains("applicant_types", ["Nonprofit"]);

  if (error || !grants) return [];

  const now = new Date();
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const matched: MatchedGrant[] = [];

  for (const grant of grants as Grant[]) {
    // Hard filter: category overlap
    if (!hasOverlap(grant.categories, org.categories)) continue;

    // Soft filter: geography
    if (!matchesGeography(grant.geography_text, org.geography_keywords)) continue;

    // Determine section
    const deadlineDate = grant.deadline_date ? new Date(grant.deadline_date) : null;
    const firstSeen = new Date(grant.first_seen_at);
    const isClosingSoon = deadlineDate && deadlineDate <= fourteenDaysFromNow && deadlineDate >= now;
    const isNewThisWeek = firstSeen >= sevenDaysAgo;

    let section: MatchedGrant["section"];
    if (isClosingSoon) {
      section = "closing_soon";
    } else if (isNewThisWeek) {
      section = "new_this_week";
    } else {
      section = "all_matching";
    }

    matched.push({ ...grant, section });
  }

  // Sort: closing_soon by deadline ASC, new_this_week by deadline ASC, all by deadline ASC
  // Grants with no deadline go to the bottom
  matched.sort((a, b) => {
    const sectionOrder = { closing_soon: 0, new_this_week: 1, all_matching: 2 };
    if (sectionOrder[a.section] !== sectionOrder[b.section]) {
      return sectionOrder[a.section] - sectionOrder[b.section];
    }
    const aDate = a.deadline_date ? new Date(a.deadline_date).getTime() : Infinity;
    const bDate = b.deadline_date ? new Date(b.deadline_date).getTime() : Infinity;
    return aDate - bDate;
  });

  return matched;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/matching.ts
git commit -m "feat: add grant-to-org matching logic with section classification"
```

---

### Task 5: Email Rendering + Resend Integration

**Files:**
- Create: `src/lib/email.ts`

- [ ] **Step 1: Write email module**

Create `src/lib/email.ts`:

```typescript
import { Resend } from "resend";
import type { MatchedGrant } from "./matching";

const resend = new Resend(process.env.RESEND_API_KEY);

function truncate(text: string | null, len: number): string {
  if (!text) return "";
  return text.length > len ? text.slice(0, len - 3) + "..." : text;
}

function formatGrantLine(grant: MatchedGrant, includePurpose: boolean): string {
  const parts = [
    `  ${grant.agency || "Unknown Agency"}`,
    `Deadline: ${grant.application_deadline || "Ongoing"}`,
  ];
  if (grant.est_amounts_text) parts.push(grant.est_amounts_text);
  let line = `\u2022 ${grant.title}\n  ${parts.join(" | ")}`;
  if (includePurpose && grant.purpose) {
    line += `\n  ${truncate(grant.purpose, 120)}`;
  }
  if (grant.grant_url) {
    line += `\n  \u2192 ${grant.grant_url}`;
  }
  return line;
}

export function renderDigestText(
  orgName: string,
  grants: MatchedGrant[],
  settingsUrl: string,
  unsubscribeUrl: string,
  trialBanner: boolean
): string {
  const closingSoon = grants.filter((g) => g.section === "closing_soon");
  const newThisWeek = grants.filter((g) => g.section === "new_this_week");
  const allMatching = grants.filter((g) => g.section === "all_matching");

  let body = "";

  if (trialBanner) {
    body += "--- YOUR FREE TRIAL HAS ENDED ---\n\n";
    body += "Subscribe for $49/mo to keep receiving your weekly grant digest.\n";
    body += `Subscribe now: ${process.env.BASE_URL}/api/checkout?org=${encodeURIComponent(orgName)}\n\n`;
  }

  if (closingSoon.length > 0) {
    body += "--- CLOSING SOON ---\n\n";
    body += closingSoon.map((g) => formatGrantLine(g, true)).join("\n\n");
    body += "\n\n";
  }

  if (newThisWeek.length > 0) {
    body += "--- NEW THIS WEEK ---\n\n";
    body += newThisWeek.map((g) => formatGrantLine(g, true)).join("\n\n");
    body += "\n\n";
  }

  if (allMatching.length > 0) {
    body += "--- ALL MATCHING ---\n\n";
    body += allMatching.map((g) => formatGrantLine(g, false)).join("\n\n");
    body += "\n\n";
  }

  body += "---\n";
  body += `Manage your categories: ${settingsUrl}\n`;
  body += `Unsubscribe: ${unsubscribeUrl}\n`;

  return body;
}

export async function sendDigestEmail(
  to: string,
  orgName: string,
  grants: MatchedGrant[],
  unsubscribeToken: string,
  trialBanner: boolean
): Promise<{ id: string } | null> {
  const baseUrl = process.env.BASE_URL || "https://grantradar.com";
  const settingsUrl = `${baseUrl}/settings?token=${unsubscribeToken}`;
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}`;
  const weekOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const text = renderDigestText(orgName, grants, settingsUrl, unsubscribeUrl, trialBanner);

  const { data, error } = await resend.emails.send({
    from: "GrantRadar <digest@grantradar.com>",
    to,
    subject: `GrantRadar \u2014 ${grants.length} grants for ${orgName} (Week of ${weekOf})`,
    text,
  });

  if (error) {
    console.error(`Failed to send digest to ${to}:`, error);
    return null;
  }

  return data;
}

export async function sendConfirmationEmail(to: string, orgName: string): Promise<void> {
  await resend.emails.send({
    from: "GrantRadar <hello@grantradar.com>",
    to,
    subject: `Welcome to GrantRadar, ${orgName}!`,
    text: `You're signed up for GrantRadar.\n\nEvery Monday, we'll email you CA state grants that match your nonprofit's categories and geography.\n\nYour first digest arrives next Monday. If you signed up on a Monday morning, check your inbox later today.\n\nQuestions? Reply to this email.\n\n- GrantRadar`,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat: add email rendering and Resend integration"
```

---

### Task 6: Digest Cron (Send Weekly Emails)

**Files:**
- Create: `src/app/api/send-digests/route.ts`

- [ ] **Step 1: Write the digest sender route**

Create `src/app/api/send-digests/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { matchGrantsForOrg } from "@/lib/matching";
import { sendDigestEmail } from "@/lib/email";
import { TRIAL_DIGEST_LIMIT } from "@/lib/constants";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all orgs eligible for digest
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .in("subscription_status", ["trial", "active"]);

  if (orgError || !orgs) {
    return NextResponse.json({ error: orgError?.message || "No orgs" }, { status: 500 });
  }

  const results: Array<{ org: string; status: string; grants: number }> = [];

  for (const org of orgs) {
    const matched = await matchGrantsForOrg({
      id: org.id,
      categories: org.categories,
      geography_keywords: org.geography_keywords,
    });

    // Empty digest: skip sending, do NOT increment trial counter
    if (matched.length === 0) {
      results.push({ org: org.name, status: "skipped_empty", grants: 0 });
      continue;
    }

    // Determine if this is the upgrade-prompt send (trial org, already received TRIAL_DIGEST_LIMIT digests)
    const isTrialExpiring = org.subscription_status === "trial" && org.trial_digests_sent >= TRIAL_DIGEST_LIMIT;

    if (isTrialExpiring) {
      // This org's trial is over. Send one final digest with upgrade banner, then expire.
      const emailResult = await sendDigestEmail(
        org.email, org.name, matched, org.unsubscribe_token, true
      );

      await supabase
        .from("organizations")
        .update({ subscription_status: "expired" })
        .eq("id", org.id);

      if (emailResult) {
        await supabase.from("digests").insert({
          org_id: org.id,
          grant_count: matched.length,
          resend_message_id: emailResult.id,
        });
      }

      results.push({ org: org.name, status: "trial_expired", grants: matched.length });
      continue;
    }

    // Normal send (trial or active)
    const emailResult = await sendDigestEmail(
      org.email, org.name, matched, org.unsubscribe_token, false
    );

    if (emailResult) {
      // Increment trial counter if trial org
      if (org.subscription_status === "trial") {
        await supabase
          .from("organizations")
          .update({ trial_digests_sent: org.trial_digests_sent + 1 })
          .eq("id", org.id);
      }

      await supabase.from("digests").insert({
        org_id: org.id,
        grant_count: matched.length,
        resend_message_id: emailResult.id,
      });

      results.push({ org: org.name, status: "sent", grants: matched.length });
    } else {
      // Send failed: do NOT increment trial counter
      results.push({ org: org.name, status: "send_failed", grants: matched.length });
    }
  }

  return NextResponse.json({ sent: results.length, results });
}
```

Trial logic (explicit sequence):
- `trial_digests_sent = 0`: send digest, increment to 1
- `trial_digests_sent = 1`: send digest, increment to 2
- `trial_digests_sent = 2` (>= TRIAL_DIGEST_LIMIT): send final digest WITH upgrade banner, set status to `expired`
- `subscription_status = expired`: not queried, no more digests

- [ ] **Step 2: Commit**

```bash
git add src/app/api/send-digests/route.ts
git commit -m "feat: add weekly digest cron with trial logic and empty-digest guard"
```

---

### Task 7: Signup API + Landing Page

**Files:**
- Create: `src/app/api/signup/route.ts`
- Create: `src/components/signup-form.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Write signup API route**

Create `src/app/api/signup/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendConfirmationEmail } from "@/lib/email";
import { GRANT_CATEGORIES } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, email, categories, geography_keywords } = body;

  if (!name || !email || !categories || categories.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Validate categories
  const validCategories = categories.filter((c: string) =>
    (GRANT_CATEGORIES as readonly string[]).includes(c)
  );
  if (validCategories.length === 0) {
    return NextResponse.json({ error: "No valid categories selected" }, { status: 400 });
  }

  // Parse geography keywords
  const geoKeywords = (geography_keywords || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const { data, error } = await supabase
    .from("organizations")
    .insert({
      name,
      email,
      categories: validCategories,
      geography_keywords: geoKeywords,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await sendConfirmationEmail(email, name);

  return NextResponse.json({ success: true, id: data.id });
}
```

- [ ] **Step 2: Write signup form component**

Create `src/components/signup-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GRANT_CATEGORIES } from "@/lib/constants";

export function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [geoKeywords, setGeoKeywords] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        categories: selectedCategories,
        geography_keywords: geoKeywords,
      }),
    });

    if (res.ok) {
      setStatus("success");
    } else {
      const data = await res.json();
      setErrorMsg(data.error || "Something went wrong");
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <Card className="max-w-lg mx-auto border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <CardContent className="p-8 text-center">
          <h3 className="text-xl font-bold text-green-800 dark:text-green-200">You're in!</h3>
          <p className="mt-2 text-green-700 dark:text-green-300">
            Check your email for a confirmation. Your first grant digest arrives Monday.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>Get your weekly grant digest</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Organization Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Grant Categories (select all that apply)</Label>
            <div className="grid grid-cols-2 gap-2">
              {GRANT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`text-left text-sm px-3 py-2 rounded-md border transition-colors ${
                    selectedCategories.includes(cat)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="geo">Geography Keywords (comma-separated, optional)</Label>
            <Input
              id="geo"
              value={geoKeywords}
              onChange={(e) => setGeoKeywords(e.target.value)}
              placeholder="e.g. Nevada County, Northern California, Statewide"
            />
            <p className="text-xs text-muted-foreground">
              We'll match grants mentioning these areas. Leave blank to get statewide grants only.
            </p>
          </div>
          {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
          <Button type="submit" className="w-full" disabled={status === "loading" || selectedCategories.length === 0}>
            {status === "loading" ? "Signing up..." : "Start Free Trial (2 weeks)"}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Free for 2 weekly digests, then $49/mo. Cancel anytime.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Write landing page**

Replace `src/app/page.tsx`:

```tsx
import { SignupForm } from "@/components/signup-form";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">GrantRadar</h1>
          <p className="text-muted-foreground">Grant deadline intelligence for California nonprofits</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold tracking-tight mb-4">
            Stop missing grants.
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Every Monday, get a personalized email with CA state grants that match your
            nonprofit. Matched by category and geography. No login required.
          </p>
        </div>

        <SignupForm />

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          <div>
            <h3 className="font-semibold mb-2">160+ Active Grants</h3>
            <p className="text-sm text-muted-foreground">
              Synced daily from the CA Grants Portal. We watch so you don't have to.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Matched to You</h3>
            <p className="text-sm text-muted-foreground">
              Filtered by your categories and geography. Only see what's relevant.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">$49/mo</h3>
            <p className="text-sm text-muted-foreground">
              2 free digests to try. Cancel anytime. Cheaper than missing one grant.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Update layout**

Update `src/app/layout.tsx` metadata:

```tsx
export const metadata: Metadata = {
  title: "GrantRadar — Grant Deadline Intelligence for CA Nonprofits",
  description: "Weekly email digest of CA state grants matched to your nonprofit. Never miss a deadline.",
};
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/signup/ src/components/signup-form.tsx src/app/page.tsx src/app/layout.tsx
git commit -m "feat: add signup API, form component, and landing page"
```

---

### Task 8: Stripe Checkout + Webhook

**Files:**
- Create: `src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Write Stripe webhook handler**

Create `src/app/api/webhooks/stripe/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_email;
    const customerId = session.customer as string;

    if (email) {
      await supabase
        .from("organizations")
        .update({ subscription_status: "active", stripe_customer_id: customerId })
        .eq("email", email);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    await supabase
      .from("organizations")
      .update({ subscription_status: "cancelled" })
      .eq("stripe_customer_id", customerId);
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/webhooks/stripe/
git commit -m "feat: add Stripe webhook for subscription management"
```

---

### Task 9: Token Pages (Unsubscribe + Settings)

**Files:**
- Create: `src/app/unsubscribe/page.tsx`
- Create: `src/app/settings/page.tsx`
- Create: `src/app/api/settings/route.ts`

- [ ] **Step 1: Write unsubscribe page**

Create `src/app/unsubscribe/page.tsx`:

```tsx
import { supabase } from "@/lib/supabase";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <div className="p-8 text-center">Invalid unsubscribe link.</div>;
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, subscription_status")
    .eq("unsubscribe_token", token)
    .single();

  if (!org) {
    return <div className="p-8 text-center">Invalid or expired unsubscribe link.</div>;
  }

  if (org.subscription_status === "cancelled") {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold">Already unsubscribed</h2>
        <p className="text-muted-foreground mt-2">{org.name} is already unsubscribed from GrantRadar.</p>
      </div>
    );
  }

  // Perform unsubscribe
  await supabase
    .from("organizations")
    .update({ subscription_status: "cancelled" })
    .eq("unsubscribe_token", token);

  return (
    <div className="p-8 text-center">
      <h2 className="text-xl font-bold">Unsubscribed</h2>
      <p className="text-muted-foreground mt-2">
        {org.name} has been unsubscribed from GrantRadar. You won't receive any more digests.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write settings page**

Create `src/app/settings/page.tsx` as a client component with a server data fetch:

```tsx
import { supabase } from "@/lib/supabase";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <div className="p-8 text-center">Invalid settings link.</div>;
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, categories, geography_keywords, unsubscribe_token")
    .eq("unsubscribe_token", token)
    .single();

  if (!org) {
    return <div className="p-8 text-center">Invalid or expired link.</div>;
  }

  return (
    <div className="max-w-lg mx-auto p-8">
      <h2 className="text-xl font-bold mb-4">Settings for {org.name}</h2>
      <SettingsForm
        token={token}
        initialCategories={org.categories}
        initialGeoKeywords={org.geography_keywords.join(", ")}
      />
    </div>
  );
}
```

Create `src/app/settings/settings-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GRANT_CATEGORIES } from "@/lib/constants";

export function SettingsForm({
  token,
  initialCategories,
  initialGeoKeywords,
}: {
  token: string;
  initialCategories: string[];
  initialGeoKeywords: string;
}) {
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [geoKeywords, setGeoKeywords] = useState(initialGeoKeywords);
  const [saved, setSaved] = useState(false);

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, categories, geography_keywords: geoKeywords }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Categories</Label>
        <div className="grid grid-cols-2 gap-2">
          {GRANT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`text-left text-sm px-3 py-2 rounded-md border transition-colors ${
                categories.includes(cat)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="geo">Geography Keywords</Label>
        <Input id="geo" value={geoKeywords} onChange={(e) => setGeoKeywords(e.target.value)} />
      </div>
      <Button type="submit" className="w-full">
        {saved ? "Saved!" : "Save Changes"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Write settings API route**

Create `src/app/api/settings/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { GRANT_CATEGORIES } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const { token, categories, geography_keywords } = await request.json();

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const validCategories = (categories || []).filter((c: string) =>
    (GRANT_CATEGORIES as readonly string[]).includes(c)
  );

  const geoKeywords = (geography_keywords || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const { error } = await supabase
    .from("organizations")
    .update({ categories: validCategories, geography_keywords: geoKeywords })
    .eq("unsubscribe_token", token);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/unsubscribe/ src/app/settings/ src/app/api/settings/
git commit -m "feat: add token-based unsubscribe and settings pages"
```

---

### Task 10: Build, Verify, Deploy

- [ ] **Step 1: Create .env.local with real values**

Copy `.env.local.example` to `.env.local` and fill in real credentials (Supabase, Resend, Stripe).

- [ ] **Step 2: Run build**

```bash
pnpm build
```

Expected: Clean build, all routes compile.

- [ ] **Step 3: Test signup flow locally**

```bash
pnpm dev
# Visit http://localhost:3000
# Fill out signup form
# Check Supabase for new organization record
# Check email for confirmation
```

- [ ] **Step 4: Test sync locally**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/sync-grants
```

Expected: `{ "fetched": ~1874, "upserted": ~1874, "closed": 0 }`

- [ ] **Step 5: Test digest locally**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/send-digests
```

Expected: JSON showing digests sent to signed-up orgs.

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "feat: GrantRadar v1 complete - grant digest for CA nonprofits"
```

- [ ] **Step 7: Deploy to Vercel**

```bash
vercel --prod
```

Set environment variables in Vercel dashboard. Verify cron jobs are registered.

---

## Post-Build Checklist

After deployment, run these gstack skills:
- `/review` — code review the full diff
- `/qa` — test the live site
- `/cso` — security audit (Stripe webhook validation, token exposure)
- `/document-release` — update any docs

## What's NOT in This Plan

- No tests (v1 is a validation experiment, not a production system. Add tests when there's a paying customer.)
- No CI/CD pipeline (Vercel handles deploy on push)
- No monitoring/alerting (check Resend dashboard and Supabase manually)
- No rate limiting on signup (add if abuse appears)
