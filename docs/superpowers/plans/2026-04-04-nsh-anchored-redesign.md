# NSH-Anchored Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GrantRadar genuinely useful for Kaelen at Northstar House (a 20hr/week nonprofit dev director at a CA historic preservation org) by adding mission keyword relevance scoring, minimum grant amount filtering, and deadline context so the weekly digest surfaces the 3-5 grants actually worth his time instead of 30+ category-matched noise.

**Architecture:** Add `mission_keywords` (text[]) and `min_grant_amount` (integer) columns to organizations. The matching engine scores each grant by keyword hits in title/purpose/description, filters by minimum amount, and sorts by relevance score within sections. The digest email shows WHY each grant matched and adds deadline context ("X days left"). Signup and settings forms capture these new fields.

**Tech Stack:** Next.js 16, Supabase (Postgres), Resend, TypeScript

**Anchor user story:** Kaelen at Northstar House signs up with categories ["Libraries and Arts", "Parks & Recreation", "Housing, Community and Economic Development"], mission keywords ["historic preservation", "cultural heritage", "landmark", "museum", "historic site"], and min amount $10,000. His Monday digest leads with the 2-3 grants that mention historic preservation, not the 25 library digitization grants that technically match his categories.

---

### Task 1: Database Migration — Add Mission Keywords and Min Amount

**Files:**
- Create: `supabase/migrations/003_mission_keywords.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Add mission keywords for relevance scoring
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS mission_keywords text[] NOT NULL DEFAULT '{}';

-- Add minimum grant amount filter (in dollars, null = no filter)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS min_grant_amount integer DEFAULT NULL;

-- Add index for future queries
CREATE INDEX IF NOT EXISTS idx_organizations_mission_keywords ON organizations USING gin (mission_keywords);
```

- [ ] **Step 2: Apply migration via Supabase MCP or dashboard**

Run the SQL against the GrantRadar Supabase project (ppsexpgopqzshkcknxqt).

- [ ] **Step 3: Verify columns exist**

```bash
source ~/.claude/.env
curl -s "https://ppsexpgopqzshkcknxqt.supabase.co/rest/v1/organizations?select=mission_keywords,min_grant_amount&limit=1" \
  -H "apikey: $SUPABASE_GRANTRADAR_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_GRANTRADAR_SERVICE_ROLE_KEY"
```

Expected: `[{"mission_keywords":[],"min_grant_amount":null}]`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_mission_keywords.sql
git commit -m "feat: add mission_keywords and min_grant_amount columns to organizations"
```

---

### Task 2: Update Matching Engine with Relevance Scoring

**Files:**
- Modify: `src/lib/matching.ts`

The matching engine currently returns `MatchedGrant` with a `section` field. We add a `relevanceScore` (0-100) and `matchReason` (string) to each result. Scoring:
- +50 for keyword hit in title (most visible, highest signal)
- +30 for keyword hit in purpose
- +20 for keyword hit in description
- Multiple keyword hits stack (capped at 100)
- 0 if no keyword matches (still included if category matches, just ranked lower)

- [ ] **Step 1: Update the MatchedGrant interface and Organization interface**

Replace the entire `src/lib/matching.ts` with:

```typescript
import { supabase } from "./supabase";

interface Organization {
  id: string;
  categories: string[];
  geography_keywords: string[];
  mission_keywords: string[];
  min_grant_amount: number | null;
}

interface Grant {
  id: string;
  portal_id: number;
  status: string;
  title: string;
  agency: string;
  purpose: string;
  description: string;
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
  relevanceScore: number;
  matchReason: string;
}

function hasOverlap(a: string[], b: string[]): boolean {
  const setB = new Set(b.map((s) => s.toLowerCase()));
  return a.some((item) => setB.has(item.toLowerCase()));
}

function matchesGeography(geoText: string | null, keywords: string[]): boolean {
  if (!geoText || geoText.trim() === "") return true;
  const lower = geoText.toLowerCase();
  if (lower.includes("statewide") || lower.includes("california")) return true;
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function parseMinAmount(text: string | null): number | null {
  if (!text) return null;
  // Match patterns like "$100,000", "Up to $500,000", "Between $50,000 and $200,000"
  const matches = text.match(/\$[\d,]+/g);
  if (!matches || matches.length === 0) return null;
  // Take the first dollar amount as the minimum
  const first = matches[0].replace(/[$,]/g, "");
  const num = parseInt(first, 10);
  return isNaN(num) ? null : num;
}

function scoreRelevance(grant: Grant, keywords: string[]): { score: number; reason: string } {
  if (keywords.length === 0) return { score: 0, reason: "Category match" };

  let score = 0;
  const reasons: string[] = [];
  const titleLower = (grant.title || "").toLowerCase();
  const purposeLower = (grant.purpose || "").toLowerCase();
  const descLower = (grant.description || "").toLowerCase();

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (titleLower.includes(kwLower)) {
      score += 50;
      reasons.push(`"${kw}" in title`);
    } else if (purposeLower.includes(kwLower)) {
      score += 30;
      reasons.push(`"${kw}" in purpose`);
    } else if (descLower.includes(kwLower)) {
      score += 20;
      reasons.push(`"${kw}" in description`);
    }
  }

  if (score === 0) return { score: 0, reason: "Category match" };
  return { score: Math.min(score, 100), reason: reasons.slice(0, 2).join(", ") };
}

export async function matchGrantsForOrg(org: Organization): Promise<MatchedGrant[]> {
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

    // Filter by minimum grant amount
    if (org.min_grant_amount) {
      const grantAmount = parseMinAmount(grant.est_amounts_text);
      // Skip if grant has a stated amount and it's below the org's minimum
      // Include grants with no stated amount (don't penalize missing data)
      if (grantAmount !== null && grantAmount < org.min_grant_amount) continue;
    }

    // Score relevance
    const { score, reason } = scoreRelevance(grant, org.mission_keywords);

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

    matched.push({ ...grant, section, relevanceScore: score, matchReason: reason });
  }

  // Sort: by section first, then by relevance score DESC within each section, then by deadline ASC
  matched.sort((a, b) => {
    const sectionOrder = { closing_soon: 0, new_this_week: 1, all_matching: 2 };
    if (sectionOrder[a.section] !== sectionOrder[b.section]) {
      return sectionOrder[a.section] - sectionOrder[b.section];
    }
    // Within same section: higher relevance first
    if (a.relevanceScore !== b.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    // Same relevance: closer deadline first
    const aDate = a.deadline_date ? new Date(a.deadline_date).getTime() : Infinity;
    const bDate = b.deadline_date ? new Date(b.deadline_date).getTime() : Infinity;
    return aDate - bDate;
  });

  return matched;
}
```

- [ ] **Step 2: Verify the build passes**

```bash
npx next build 2>&1 | tail -5
```

Expected: Build succeeds (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/matching.ts
git commit -m "feat: add relevance scoring with mission keyword matching and min amount filter"
```

---

### Task 3: Update Send-Digests to Pass New Org Fields

**Files:**
- Modify: `src/app/api/send-digests/route.ts:28-31`

- [ ] **Step 1: Update the matchGrantsForOrg call to include new fields**

In `src/app/api/send-digests/route.ts`, replace the `matchGrantsForOrg` call:

```typescript
    const matched = await matchGrantsForOrg({
      id: org.id,
      categories: org.categories,
      geography_keywords: org.geography_keywords,
      mission_keywords: org.mission_keywords || [],
      min_grant_amount: org.min_grant_amount || null,
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/send-digests/route.ts
git commit -m "feat: pass mission_keywords and min_grant_amount to matching engine"
```

---

### Task 4: Update Email Templates with Relevance Reason and Deadline Context

**Files:**
- Modify: `src/lib/email-templates.ts:16-29` (renderGrantCard)
- Modify: `src/lib/email.ts:16-29` (formatGrantLine for plain text)

- [ ] **Step 1: Update the HTML grant card to show match reason and deadline context**

In `src/lib/email-templates.ts`, replace the `renderGrantCard` function:

```typescript
function deadlineContext(grant: MatchedGrant): string {
  if (!grant.deadline_date) return "Ongoing";
  const deadline = new Date(grant.deadline_date);
  const now = new Date();
  const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return "Closed";
  if (daysLeft <= 7) return `${daysLeft}d left — tight timeline`;
  if (daysLeft <= 14) return `${daysLeft}d left — closing soon`;
  if (daysLeft <= 30) return `${daysLeft}d left`;
  if (daysLeft <= 90) return `${Math.floor(daysLeft / 7)}wk left — good runway`;
  return `${Math.floor(daysLeft / 30)}mo left`;
}

function renderGrantCard(grant: MatchedGrant, showPurpose: boolean): string {
  const deadline = deadlineContext(grant);
  const amount = grant.est_amounts_text ? ` · ${escapeHtml(grant.est_amounts_text)}` : "";
  const purpose = showPurpose && grant.purpose ? `<p style="margin:4px 0 0;color:#6b7280;font-size:13px;">${escapeHtml(truncate(grant.purpose, 120))}</p>` : "";
  const link = grant.grant_url ? `<a href="${escapeHtml(grant.grant_url)}" style="color:#0d9488;font-size:13px;text-decoration:underline;">View on CA Grants Portal →</a>` : "";
  const matchTag = grant.relevanceScore > 0
    ? `<span style="display:inline-block;padding:2px 8px;background:#ecfdf5;color:#047857;border-radius:4px;font-size:11px;font-weight:600;margin-bottom:4px;">${escapeHtml(grant.matchReason)}</span><br>`
    : "";

  return `
    <tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
      ${matchTag}
      <p style="margin:0;font-weight:600;font-size:15px;color:#1e293b;">${escapeHtml(grant.title)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${escapeHtml(grant.agency || "Unknown Agency")} · ${escapeHtml(deadline)}${amount}</p>
      ${purpose}
      ${link ? `<p style="margin:6px 0 0;">${link}</p>` : ""}
    </td></tr>`;
}
```

- [ ] **Step 2: Update the plain text grant line in email.ts**

In `src/lib/email.ts`, replace the `formatGrantLine` function:

```typescript
function formatGrantLine(grant: MatchedGrant, includePurpose: boolean): string {
  const daysLeft = grant.deadline_date
    ? Math.ceil((new Date(grant.deadline_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const deadlineStr = daysLeft !== null
    ? (daysLeft <= 14 ? `${daysLeft}d left` : grant.application_deadline || "Ongoing")
    : "Ongoing";
  const parts = [
    `  ${grant.agency || "Unknown Agency"}`,
    `Deadline: ${deadlineStr}`,
  ];
  if (grant.est_amounts_text) parts.push(grant.est_amounts_text);
  const matchLine = grant.relevanceScore > 0 ? `  [Matched: ${grant.matchReason}]\n` : "";
  let line = `\u2022 ${grant.title}\n${matchLine}  ${parts.join(" | ")}`;
  if (includePurpose && grant.purpose) {
    line += `\n  ${truncate(grant.purpose, 120)}`;
  }
  if (grant.grant_url) {
    line += `\n  \u2192 ${grant.grant_url}`;
  }
  return line;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/email-templates.ts src/lib/email.ts
git commit -m "feat: show match reason and deadline context in digest emails"
```

---

### Task 5: Update Signup Form with Mission Keywords and Min Amount

**Files:**
- Modify: `src/components/signup-form.tsx`
- Modify: `src/app/api/signup/route.ts`

- [ ] **Step 1: Add mission keywords and min amount fields to the signup form**

In `src/components/signup-form.tsx`, add state variables after the existing ones (after line 15):

```typescript
  const [missionKeywords, setMissionKeywords] = useState("");
  const [minAmount, setMinAmount] = useState("");
```

Update the fetch body in `handleSubmit` (replace the `body: JSON.stringify` line):

```typescript
      body: JSON.stringify({
        name,
        email,
        categories: selectedCategories,
        geography_keywords: geoKeywords,
        mission_keywords: missionKeywords,
        min_grant_amount: minAmount ? parseInt(minAmount, 10) : null,
      }),
```

Add the new form fields after the geography keywords field (before the error message `{errorMsg && ...}`):

```tsx
          <div className="space-y-2">
            <Label htmlFor="mission">What does your org do? (keywords that describe your mission)</Label>
            <Input
              id="mission"
              value={missionKeywords}
              onChange={(e) => setMissionKeywords(e.target.value)}
              placeholder="e.g. historic preservation, cultural heritage, landmark"
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              We'll prioritize grants that mention these terms. The more specific, the better.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="minAmount">Minimum grant amount (optional)</Label>
            <select
              id="minAmount"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">Show all amounts</option>
              <option value="5000">$5,000+</option>
              <option value="10000">$10,000+</option>
              <option value="25000">$25,000+</option>
              <option value="50000">$50,000+</option>
              <option value="100000">$100,000+</option>
            </select>
          </div>
```

- [ ] **Step 2: Update the signup API to accept and store new fields**

In `src/app/api/signup/route.ts`, update the destructuring (line 8):

```typescript
  const { name, email, categories, geography_keywords, mission_keywords, min_grant_amount } = body;
```

Update the `supabase.from("organizations").insert()` call to include new fields:

```typescript
  // Parse mission keywords from comma-separated string
  const parsedMissionKeywords = (mission_keywords || "")
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
      mission_keywords: parsedMissionKeywords,
      min_grant_amount: min_grant_amount || null,
      tier: "free",
      email_verified: false,
    })
    .select("id, email_verify_token")
    .single();
```

- [ ] **Step 3: Commit**

```bash
git add src/components/signup-form.tsx src/app/api/signup/route.ts
git commit -m "feat: add mission keywords and min grant amount to signup flow"
```

---

### Task 6: Update Settings Form with Mission Keywords and Min Amount

**Files:**
- Modify: `src/app/settings/settings-form.tsx`
- Modify: `src/app/settings/page.tsx` (pass new initial values)
- Modify: `src/app/api/settings/route.ts`

- [ ] **Step 1: Update the settings form component**

In `src/app/settings/settings-form.tsx`, update the props interface:

```typescript
export function SettingsForm({
  token,
  initialCategories,
  initialGeoKeywords,
  initialMissionKeywords,
  initialMinAmount,
}: {
  token: string;
  initialCategories: string[];
  initialGeoKeywords: string;
  initialMissionKeywords: string;
  initialMinAmount: string;
}) {
```

Add state for new fields (after existing state):

```typescript
  const [missionKeywords, setMissionKeywords] = useState(initialMissionKeywords);
  const [minAmount, setMinAmount] = useState(initialMinAmount);
```

Update the fetch body in `handleSubmit`:

```typescript
      body: JSON.stringify({
        token,
        categories,
        geography_keywords: geoKeywords,
        mission_keywords: missionKeywords,
        min_grant_amount: minAmount ? parseInt(minAmount, 10) : null,
      }),
```

Add form fields before the submit button:

```tsx
      <div className="space-y-2">
        <Label htmlFor="mission">Mission Keywords</Label>
        <Input
          id="mission"
          value={missionKeywords}
          onChange={(e) => setMissionKeywords(e.target.value)}
          placeholder="e.g. historic preservation, cultural heritage"
        />
        <p className="text-xs text-muted-foreground">
          Grants mentioning these terms will be prioritized in your digest.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="minAmount">Minimum Grant Amount</Label>
        <select
          id="minAmount"
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">Show all amounts</option>
          <option value="5000">$5,000+</option>
          <option value="10000">$10,000+</option>
          <option value="25000">$25,000+</option>
          <option value="50000">$50,000+</option>
          <option value="100000">$100,000+</option>
        </select>
      </div>
```

Also update the category buttons to use the pill style from the signup form (flex-wrap instead of grid):

```tsx
      <div className="space-y-2">
        <Label>Categories</Label>
        <div className="flex flex-wrap gap-2">
          {GRANT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                categories.includes(cat)
                  ? "bg-primary text-primary-foreground border-primary font-medium"
                  : "bg-background border-border hover:bg-muted text-muted-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
```

- [ ] **Step 2: Update the settings page to pass new initial values**

In `src/app/settings/page.tsx`, find where `<SettingsForm>` is rendered and add the new props:

```tsx
        <SettingsForm
          token={token}
          initialCategories={org.categories || []}
          initialGeoKeywords={(org.geography_keywords || []).join(", ")}
          initialMissionKeywords={(org.mission_keywords || []).join(", ")}
          initialMinAmount={org.min_grant_amount ? String(org.min_grant_amount) : ""}
        />
```

- [ ] **Step 3: Update the settings API to accept and store new fields**

In `src/app/api/settings/route.ts`, update the destructuring:

```typescript
  const { token, categories, geography_keywords, mission_keywords, min_grant_amount } = await request.json();
```

Parse mission keywords and update the Supabase update call:

```typescript
  const parsedMissionKeywords = (mission_keywords || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const { error } = await supabase
    .from("organizations")
    .update({
      categories: validCategories,
      geography_keywords: geoKeywords,
      mission_keywords: parsedMissionKeywords,
      min_grant_amount: min_grant_amount || null,
    })
    .eq("unsubscribe_token", token);
```

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/settings-form.tsx src/app/settings/page.tsx src/app/api/settings/route.ts
git commit -m "feat: add mission keywords and min amount editing to settings"
```

---

### Task 7: Update Homepage Copy for NSH-Anchored Messaging

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update the hero subheading and social proof copy**

The current subhead says "Free weekly email with CA state grants matched to your nonprofit." This is accurate but generic. Update it to communicate the relevance scoring value:

In `src/app/page.tsx`, update the hero paragraph:

```tsx
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Tell us what your nonprofit does. We'll score every CA state grant
            by how well it fits your mission, and email you the best matches every Monday.
          </p>
```

- [ ] **Step 2: Update the digest preview to show match reasons**

In the digest preview section, update the grant entries to show match tags:

```tsx
            <div className="space-y-3">
              <div>
                <p className="text-xs font-bold text-amber-700 tracking-wide">CLOSING SOON</p>
                <span className="inline-block mt-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-semibold rounded">
                  "cultural heritage" in purpose
                </span>
                <p className="text-sm font-medium mt-1">CA Arts Council: Arts & Cultural Organizations General Operating Relief</p>
                <p className="text-xs text-muted-foreground">62 days left — good runway · Up to $150,000</p>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-bold text-primary tracking-wide">NEW THIS WEEK</p>
                <span className="inline-block mt-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-semibold rounded">
                  "historic preservation" in title
                </span>
                <p className="text-sm font-medium mt-1">Office of Historic Preservation: Heritage Fund Grant</p>
                <p className="text-xs text-muted-foreground">5mo left · Up to $750,000</p>
              </div>
              <div className="border-t pt-3 text-xs text-muted-foreground">
                + 6 more matching grants...
              </div>
            </div>
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: update homepage copy to communicate relevance scoring value"
```

---

### Task 8: Deploy and Verify with NSH Test Signup

**Files:** (no code changes — verification only)

- [ ] **Step 1: Push and deploy**

```bash
git push
npx vercel --prod --yes
```

- [ ] **Step 2: Test the full NSH user story**

Sign up as Northstar House:
- Name: "Northstar House"
- Email: use a test email
- Categories: Libraries and Arts, Parks & Recreation, Housing/Community/Economic Development
- Mission keywords: "historic preservation, cultural heritage, landmark, museum, historic site"
- Min amount: $10,000+

Verify:
1. Signup succeeds, verification email sent
2. Settings page shows all new fields with correct initial values
3. Settings save works for mission keywords and min amount

- [ ] **Step 3: Test the matching engine manually**

Hit the send-digests endpoint (or test matching directly) and verify:
- Grants mentioning "historic preservation" in title rank highest
- Grants under $10,000 are filtered out
- Grants with no stated amount are still included
- Match reason appears in the result

- [ ] **Step 4: Visual QA on the live site**

Navigate to the homepage, grants listing, and grant detail pages. Verify:
- Mission keywords field appears in signup form
- Min amount dropdown works
- Digest preview shows match reasons
- No console errors

---

## Self-Review Checklist

1. **Spec coverage:** Migration ✓, matching engine ✓, signup ✓, settings ✓, email templates ✓, digest API ✓, homepage copy ✓, deploy+verify ✓
2. **Placeholder scan:** No TBDs, TODOs, or "similar to Task N" found.
3. **Type consistency:** `Organization` interface in matching.ts has `mission_keywords: string[]` and `min_grant_amount: number | null`. Signup passes `mission_keywords` as comma-separated string (parsed server-side). Settings API parses the same way. Send-digests passes `org.mission_keywords || []` and `org.min_grant_amount || null`. Consistent.
