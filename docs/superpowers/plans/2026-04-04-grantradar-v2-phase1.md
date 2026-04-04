# GrantRadar v2 Phase 1-2: Production Readiness + Free Tier Launch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical production blockers, pivot pricing to free tier + $19/mo Pro, redesign landing page with trust signals, and ship HTML emails with proper deliverability headers.

**Architecture:** Existing Next.js 16 App Router + Supabase + Resend + Stripe. Add `tier` and `email_verified` columns to organizations. Replace trial logic with free/pro tier logic. Add Stripe Checkout session creation. Redesign landing page with navy/teal brand. Convert plain-text emails to HTML.

**Tech Stack:** Next.js 16, Supabase, Resend, Stripe, Tailwind CSS 4, shadcn/ui v4, TypeScript

**Design doc:** `~/.gstack/projects/endersclarity-grantradar/ender-main-design-20260404-091500.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/002_v2_tier_and_verification.sql` | Create | Add tier, email_verified, email_verify_token columns |
| `src/middleware.ts` | Create | Rate limiting (best-effort in-memory per cold start) |
| `src/app/error.tsx` | Create | Global error boundary |
| `src/app/settings/error.tsx` | Create | Settings error boundary |
| `src/app/unsubscribe/error.tsx` | Create | Unsubscribe error boundary |
| `src/app/api/verify-email/route.ts` | Create | Email verification endpoint |
| `src/app/api/checkout/route.ts` | Create | Stripe Checkout session creator |
| `src/lib/email-templates.ts` | Create | HTML email rendering functions |
| `src/app/grants/page.tsx` | Create | Public grant listing page |
| `src/app/grants/[id]/page.tsx` | Create | Individual grant detail page |
| `src/app/api/signup/route.ts` | Modify | Add email verification flow, set tier=free |
| `src/app/api/send-digests/route.ts` | Modify | Replace trial logic with free/pro tier logic |
| `src/app/api/webhooks/stripe/route.ts` | Modify | Set tier=pro on checkout, add idempotency |
| `src/lib/email.ts` | Modify | Use HTML templates, add List-Unsubscribe header |
| `src/lib/constants.ts` | Modify | Add STRIPE_PRICE_ID_PRO, remove TRIAL_DIGEST_LIMIT |
| `src/app/page.tsx` | Modify | Full redesign with brand, social proof, digest preview |
| `src/app/layout.tsx` | Modify | Add OG tags, serif font for headings, footer |
| `src/app/globals.css` | Modify | Navy/teal/amber brand theme |
| `src/components/signup-form.tsx` | Modify | Update copy for free tier |
| `src/app/settings/page.tsx` | Modify | Wrap in proper layout |
| `src/app/settings/settings-form.tsx` | Modify | Block save with empty categories |
| `src/app/unsubscribe/page.tsx` | Modify | Wrap in proper layout |
| `vercel.json` | Modify | Add daily Pro alert cron |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/002_v2_tier_and_verification.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Add tier column (free or pro, default free)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro'));

-- Add email verification columns
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_verify_token uuid DEFAULT gen_random_uuid();

-- Index for verify token lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_verify_token ON organizations (email_verify_token);

-- Index for email lookups (used by checkout and signup duplicate check)
CREATE INDEX IF NOT EXISTS idx_organizations_email ON organizations (email);

-- Migrate existing trial/active orgs: keep their status, set tier=free
-- (No paying customers exist yet, so this is safe)
UPDATE organizations SET tier = 'free' WHERE tier IS NULL OR tier = '';
```

Save to `supabase/migrations/002_v2_tier_and_verification.sql`.

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the Supabase MCP `apply_migration` tool to run this migration against the GrantRadar project (ID: `ppsexpgopqzshkcknxqt`). The migration name should be `v2_tier_and_verification`.

Alternatively, run via SQL:
```bash
# If MCP unavailable, use curl:
curl -X POST "https://ppsexpgopqzshkcknxqt.supabase.co/rest/v1/rpc" \
  -H "apikey: $SUPABASE_GRANTRADAR_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_GRANTRADAR_SERVICE_ROLE_KEY" \
  -d '...'
```

Or use the Supabase dashboard SQL editor.

- [ ] **Step 3: Verify migration**

Query the organizations table to confirm new columns exist:
```sql
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'organizations' AND column_name IN ('tier', 'email_verified', 'email_verify_token');
```

Expected: 3 rows showing tier (text, 'free'), email_verified (boolean, false), email_verify_token (uuid).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/002_v2_tier_and_verification.sql
git commit -m "feat: add tier and email verification columns to organizations"
```

---

### Task 2: Rate Limiting Middleware

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create the middleware**

This is best-effort rate limiting using an in-memory Map. On Vercel serverless, each cold start resets the map, so it won't catch sustained attacks across instances. But it stops basic abuse within a single instance lifecycle.

```typescript
import { NextRequest, NextResponse } from "next/server";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20; // 20 requests per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > MAX_REQUESTS;
}

export function middleware(request: NextRequest) {
  // Only rate-limit API routes (not pages)
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Skip cron endpoints (they use Bearer auth)
  if (
    request.nextUrl.pathname === "/api/sync-grants" ||
    request.nextUrl.pathname === "/api/send-digests"
  ) {
    return NextResponse.next();
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/ender/code/grantradar && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add rate limiting middleware for API routes"
```

---

### Task 3: Error Boundaries

**Files:**
- Create: `src/app/error.tsx`
- Create: `src/app/settings/error.tsx`
- Create: `src/app/unsubscribe/error.tsx`

- [ ] **Step 1: Create global error boundary**

```typescript
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-xl font-bold">Something went wrong</h2>
        <p className="text-muted-foreground">
          We hit an unexpected error. This has been logged and we'll look into it.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create settings error boundary**

```typescript
"use client";

export default function SettingsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-lg mx-auto p-8 text-center space-y-4">
      <h2 className="text-xl font-bold">Couldn't load your settings</h2>
      <p className="text-muted-foreground">
        The settings link may be invalid or expired. Check your email for a fresh link.
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create unsubscribe error boundary**

```typescript
"use client";

export default function UnsubscribeError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-md mx-auto p-8 text-center space-y-4">
      <h2 className="text-xl font-bold">Couldn't process unsubscribe</h2>
      <p className="text-muted-foreground">
        The unsubscribe link may be invalid or expired. Check your email for a fresh link.
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/ender/code/grantradar && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/error.tsx src/app/settings/error.tsx src/app/unsubscribe/error.tsx
git commit -m "feat: add error boundaries for global, settings, and unsubscribe routes"
```

---

### Task 4: Email Verification Flow

**Files:**
- Create: `src/app/api/verify-email/route.ts`
- Modify: `src/app/api/signup/route.ts`
- Modify: `src/lib/email.ts`

- [ ] **Step 1: Create verify-email route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing verification token" }, { status: 400 });
  }

  const { data: org, error: fetchError } = await supabase
    .from("organizations")
    .select("id, email_verified")
    .eq("email_verify_token", token)
    .single();

  if (fetchError || !org) {
    return NextResponse.json({ error: "Invalid or expired verification link" }, { status: 404 });
  }

  if (org.email_verified) {
    // Already verified — redirect to homepage with message
    return NextResponse.redirect(new URL("/?verified=already", request.url));
  }

  const { error: updateError } = await supabase
    .from("organizations")
    .update({ email_verified: true })
    .eq("id", org.id);

  if (updateError) {
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }

  return NextResponse.redirect(new URL("/?verified=success", request.url));
}
```

- [ ] **Step 2: Update signup route to NOT send confirmation, send verification instead**

Replace the full `src/app/api/signup/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendVerificationEmail } from "@/lib/email";
import { GRANT_CATEGORIES } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, email, categories, geography_keywords } = body;

  if (!name || !email || !categories || categories.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (name.length > 200 || email.length > 200) {
    return NextResponse.json({ error: "Name or email too long" }, { status: 400 });
  }

  if (typeof geography_keywords === "string" && geography_keywords.length > 500) {
    return NextResponse.json({ error: "Geography keywords too long" }, { status: 400 });
  }

  const validCategories = categories.filter((c: string) =>
    (GRANT_CATEGORIES as readonly string[]).includes(c)
  );
  if (validCategories.length === 0) {
    return NextResponse.json({ error: "No valid categories selected" }, { status: 400 });
  }

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
      tier: "free",
      email_verified: false,
    })
    .select("id, email_verify_token")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const baseUrl = process.env.BASE_URL || "https://grantradar-sable.vercel.app";
  await sendVerificationEmail(email, name, `${baseUrl}/api/verify-email?token=${data.email_verify_token}`);

  return NextResponse.json({ success: true, id: data.id });
}
```

- [ ] **Step 3: Add sendVerificationEmail to lib/email.ts**

Add this function to `src/lib/email.ts` after the existing `sendConfirmationEmail` function:

```typescript
export async function sendVerificationEmail(to: string, orgName: string, verifyUrl: string): Promise<void> {
  await getResend().emails.send({
    from: "GrantRadar <hello@grantradar.com>",
    to,
    subject: `Verify your email — GrantRadar`,
    text: `Hi ${orgName},\n\nPlease verify your email to start receiving your free weekly grant digest.\n\nClick here to verify: ${verifyUrl}\n\nIf you didn't sign up for GrantRadar, you can ignore this email.\n\n— GrantRadar`,
    headers: {
      "List-Unsubscribe": `<${verifyUrl.replace("/api/verify-email", "/unsubscribe")}>`,
    },
  });
}
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/ender/code/grantradar && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/verify-email/route.ts src/app/api/signup/route.ts src/lib/email.ts
git commit -m "feat: add email verification flow, send verify link on signup"
```

---

### Task 5: Stripe Checkout Endpoint + Webhook Update

**Files:**
- Create: `src/app/api/checkout/route.ts`
- Modify: `src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Create checkout route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

export async function POST(request: NextRequest) {
  const { org_id } = await request.json();

  if (!org_id) {
    return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
  }

  // Look up org to get email
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, email, name, tier")
    .eq("id", org_id)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  if (org.tier === "pro") {
    return NextResponse.json({ error: "Already on Pro tier" }, { status: 400 });
  }

  const baseUrl = process.env.BASE_URL || "https://grantradar-sable.vercel.app";

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer_email: org.email,
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID!,
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/?upgraded=success`,
    cancel_url: `${baseUrl}/?upgraded=cancelled`,
    metadata: {
      org_id: org.id,
    },
  });

  return NextResponse.json({ url: session.url });
}
```

- [ ] **Step 2: Update webhook to set tier=pro and add idempotency**

Replace the full `src/app/api/webhooks/stripe/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency: check if we've already processed this event
  const { data: existing } = await supabase
    .from("webhook_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .single();

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Log the event for idempotency
  await supabase.from("webhook_events").insert({ stripe_event_id: event.id, event_type: event.type });

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_email;
    const customerId = session.customer as string;

    if (email) {
      await supabase
        .from("organizations")
        .update({
          subscription_status: "active",
          stripe_customer_id: customerId,
          tier: "pro",
        })
        .eq("email", email);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    await supabase
      .from("organizations")
      .update({ subscription_status: "cancelled", tier: "free" })
      .eq("stripe_customer_id", customerId);
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 3: Add webhook_events table to migration**

Append to `supabase/migrations/002_v2_tier_and_verification.sql`:

```sql
-- Webhook idempotency table
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON webhook_events (stripe_event_id);
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/ender/code/grantradar && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/checkout/route.ts src/app/api/webhooks/stripe/route.ts supabase/migrations/002_v2_tier_and_verification.sql
git commit -m "feat: add checkout endpoint, update webhook for tier + idempotency"
```

---

### Task 6: Free Tier Digest Logic

**Files:**
- Modify: `src/app/api/send-digests/route.ts`
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Update constants — remove trial limit, add Pro price**

Replace the full `src/lib/constants.ts`:

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

export const MIN_CSV_ROWS_SAFETY = 50;
```

- [ ] **Step 2: Replace send-digests with free tier logic**

Replace the full `src/app/api/send-digests/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { matchGrantsForOrg } from "@/lib/matching";
import { sendDigestEmail } from "@/lib/email";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Free tier: send to all verified free + active orgs (weekly, Mondays)
  // Pro tier orgs also get the weekly digest
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("email_verified", true)
    .in("subscription_status", ["trial", "active"])
    .not("subscription_status", "eq", "cancelled");

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

    if (matched.length === 0) {
      results.push({ org: org.name, status: "skipped_empty", grants: 0 });
      continue;
    }

    const emailResult = await sendDigestEmail(
      org.email, org.name, matched, org.unsubscribe_token, false
    );

    if (emailResult) {
      await supabase.from("digests").insert({
        org_id: org.id,
        grant_count: matched.length,
        resend_message_id: emailResult.id,
      });
      results.push({ org: org.name, status: "sent", grants: matched.length });
    } else {
      results.push({ org: org.name, status: "send_failed", grants: matched.length });
    }
  }

  return NextResponse.json({ sent: results.length, results });
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/ender/code/grantradar && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/send-digests/route.ts src/lib/constants.ts
git commit -m "feat: replace trial logic with free tier — all verified orgs get weekly digests"
```

---

### Task 7: HTML Email Templates + List-Unsubscribe

**Files:**
- Create: `src/lib/email-templates.ts`
- Modify: `src/lib/email.ts`

- [ ] **Step 1: Create HTML email template module**

```typescript
import type { MatchedGrant } from "./matching";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(text: string | null, len: number): string {
  if (!text) return "";
  return text.length > len ? text.slice(0, len - 3) + "..." : text;
}

function renderGrantCard(grant: MatchedGrant, showPurpose: boolean): string {
  const deadline = grant.application_deadline || "Ongoing";
  const amount = grant.est_amounts_text ? ` · ${escapeHtml(grant.est_amounts_text)}` : "";
  const purpose = showPurpose && grant.purpose ? `<p style="margin:4px 0 0;color:#6b7280;font-size:13px;">${escapeHtml(truncate(grant.purpose, 120))}</p>` : "";
  const link = grant.grant_url ? `<a href="${escapeHtml(grant.grant_url)}" style="color:#0d9488;font-size:13px;text-decoration:underline;">View on CA Grants Portal →</a>` : "";

  return `
    <tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
      <p style="margin:0;font-weight:600;font-size:15px;color:#1e293b;">${escapeHtml(grant.title)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${escapeHtml(grant.agency || "Unknown Agency")} · Deadline: ${escapeHtml(deadline)}${amount}</p>
      ${purpose}
      ${link ? `<p style="margin:6px 0 0;">${link}</p>` : ""}
    </td></tr>`;
}

function renderSection(title: string, emoji: string, grants: MatchedGrant[], showPurpose: boolean): string {
  if (grants.length === 0) return "";
  return `
    <tr><td style="padding:20px 0 8px;">
      <h2 style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${emoji} ${escapeHtml(title)}</h2>
    </td></tr>
    ${grants.map((g) => renderGrantCard(g, showPurpose)).join("")}`;
}

export function renderDigestHtml(
  orgName: string,
  grants: MatchedGrant[],
  settingsUrl: string,
  unsubscribeUrl: string,
  upgradeUrl: string | null
): string {
  const closingSoon = grants.filter((g) => g.section === "closing_soon");
  const newThisWeek = grants.filter((g) => g.section === "new_this_week");
  const allMatching = grants.filter((g) => g.section === "all_matching");
  const weekOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const upgradeBanner = upgradeUrl
    ? `<tr><td style="padding:16px;background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;margin:16px 0;">
        <p style="margin:0;font-size:14px;color:#92400e;font-weight:600;">Unlock AI Fit Scores + Grant Writing Assistance</p>
        <p style="margin:4px 0 0;font-size:13px;color:#92400e;">Know which grants are worth your time. $19/mo.</p>
        <a href="${escapeHtml(upgradeUrl)}" style="display:inline-block;margin-top:8px;padding:8px 16px;background:#0d9488;color:white;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Upgrade to Pro</a>
      </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:white;border-radius:12px;border:1px solid #e2e8f0;">

  <!-- Header -->
  <tr><td style="padding:24px 24px 16px;border-bottom:1px solid #e2e8f0;">
    <h1 style="margin:0;font-size:20px;color:#0f172a;font-weight:700;">GrantRadar</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#64748b;">${escapeHtml(orgName)} · Week of ${escapeHtml(weekOf)} · ${grants.length} matching grant${grants.length !== 1 ? "s" : ""}</p>
  </td></tr>

  <!-- Upgrade banner for free tier -->
  ${upgradeBanner}

  <!-- Grant sections -->
  <tr><td style="padding:0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${renderSection("Closing Soon", "⏰", closingSoon, true)}
      ${renderSection("New This Week", "✨", newThisWeek, true)}
      ${renderSection("All Matching", "📋", allMatching, false)}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;border-radius:0 0 12px 12px;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">
      Powered by CA Grants Portal data, updated daily.<br>
      <a href="${escapeHtml(settingsUrl)}" style="color:#0d9488;">Manage categories</a> · 
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#0d9488;">Unsubscribe</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
```

- [ ] **Step 2: Update email.ts to use HTML and add List-Unsubscribe**

Replace the full `src/lib/email.ts`:

```typescript
import { Resend } from "resend";
import type { MatchedGrant } from "./matching";
import { renderDigestHtml } from "./email-templates";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function truncate(text: string | null, len: number): string {
  if (!text) return "";
  return text.length > len ? text.slice(0, len - 3) + "..." : text;
}

function renderDigestText(
  orgName: string,
  grants: MatchedGrant[],
  settingsUrl: string,
  unsubscribeUrl: string
): string {
  const closingSoon = grants.filter((g) => g.section === "closing_soon");
  const newThisWeek = grants.filter((g) => g.section === "new_this_week");
  const allMatching = grants.filter((g) => g.section === "all_matching");

  let body = "";

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

export async function sendDigestEmail(
  to: string,
  orgName: string,
  grants: MatchedGrant[],
  unsubscribeToken: string,
  showUpgradeBanner: boolean
): Promise<{ id: string } | null> {
  const baseUrl = process.env.BASE_URL || "https://grantradar-sable.vercel.app";
  const settingsUrl = `${baseUrl}/settings?token=${unsubscribeToken}`;
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}`;
  const upgradeUrl = showUpgradeBanner ? `${baseUrl}/?upgrade=true` : null;
  const weekOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const html = renderDigestHtml(orgName, grants, settingsUrl, unsubscribeUrl, upgradeUrl);
  const text = renderDigestText(orgName, grants, settingsUrl, unsubscribeUrl);

  const { data, error } = await getResend().emails.send({
    from: "GrantRadar <digest@grantradar.com>",
    to,
    subject: `GrantRadar — ${grants.length} grants for ${orgName} (Week of ${weekOf})`,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  if (error) {
    console.error(`Failed to send digest to ${to}:`, error);
    return null;
  }

  return data;
}

export async function sendVerificationEmail(to: string, orgName: string, verifyUrl: string): Promise<void> {
  await getResend().emails.send({
    from: "GrantRadar <hello@grantradar.com>",
    to,
    subject: `Verify your email — GrantRadar`,
    text: `Hi ${orgName},\n\nPlease verify your email to start receiving your free weekly grant digest.\n\nClick here to verify: ${verifyUrl}\n\nIf you didn't sign up for GrantRadar, you can ignore this email.\n\n— GrantRadar`,
  });
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/ender/code/grantradar && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email-templates.ts src/lib/email.ts
git commit -m "feat: HTML email digest with brand styling + List-Unsubscribe headers"
```

---

### Task 8: Brand Theme + Landing Page Redesign

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/signup-form.tsx`
- Modify: `src/app/settings/page.tsx`
- Modify: `src/app/unsubscribe/page.tsx`

- [ ] **Step 1: Update globals.css with navy/teal/amber brand**

Replace the `:root` block (lines 51-84) in `src/app/globals.css` with:

```css
:root {
  --background: oklch(0.985 0.002 240);
  --foreground: oklch(0.15 0.02 250);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.15 0.02 250);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.15 0.02 250);
  --primary: oklch(0.55 0.12 195);
  --primary-foreground: oklch(0.99 0 0);
  --secondary: oklch(0.96 0.005 240);
  --secondary-foreground: oklch(0.2 0.03 250);
  --muted: oklch(0.96 0.005 240);
  --muted-foreground: oklch(0.5 0.02 250);
  --accent: oklch(0.78 0.12 75);
  --accent-foreground: oklch(0.25 0.05 75);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.91 0.005 240);
  --input: oklch(0.91 0.005 240);
  --ring: oklch(0.55 0.12 195);
  --chart-1: oklch(0.55 0.12 195);
  --chart-2: oklch(0.78 0.12 75);
  --chart-3: oklch(0.45 0.08 250);
  --chart-4: oklch(0.65 0.1 160);
  --chart-5: oklch(0.6 0.15 30);
  --radius: 0.625rem;
  --sidebar: oklch(0.985 0.002 240);
  --sidebar-foreground: oklch(0.15 0.02 250);
  --sidebar-primary: oklch(0.55 0.12 195);
  --sidebar-primary-foreground: oklch(0.99 0 0);
  --sidebar-accent: oklch(0.96 0.005 240);
  --sidebar-accent-foreground: oklch(0.2 0.03 250);
  --sidebar-border: oklch(0.91 0.005 240);
  --sidebar-ring: oklch(0.55 0.12 195);
}
```

This gives: teal primary (`oklch(0.55 0.12 195)`), amber accent (`oklch(0.78 0.12 75)`), slate-blue neutrals.

- [ ] **Step 2: Update layout.tsx with OG tags and serif heading font**

Replace the full `src/app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GrantRadar — Free Grant Alerts for California Nonprofits",
  description: "Get a free weekly email with CA state grants matched to your nonprofit. Powered by the CA Grants Portal, updated daily.",
  openGraph: {
    title: "GrantRadar — Free Grant Alerts for California Nonprofits",
    description: "Weekly email digest of CA state grants matched to your nonprofit by category and geography. Free forever.",
    type: "website",
    url: "https://grantradar-sable.vercel.app",
    siteName: "GrantRadar",
  },
  twitter: {
    card: "summary_large_image",
    title: "GrantRadar — Free Grant Alerts for CA Nonprofits",
    description: "Weekly email digest of CA state grants matched to your nonprofit. Free forever.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <footer className="border-t mt-auto">
          <div className="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
            <p>Powered by <a href="https://www.grants.ca.gov/" className="underline hover:text-foreground" target="_blank" rel="noopener">CA Grants Portal</a> data, updated daily.</p>
            <p className="mt-1">Built by a California nonprofit development director who got tired of checking the portal manually.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Redesign the landing page**

Replace the full `src/app/page.tsx`:

```typescript
import { SignupForm } from "@/components/signup-form";
import { supabase } from "@/lib/supabase";

async function getGrantStats() {
  const { count: activeGrants } = await supabase
    .from("grants")
    .select("*", { count: "exact", head: true })
    .in("status", ["active", "forecasted"]);

  const { count: orgCount } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .eq("email_verified", true);

  return { activeGrants: activeGrants || 0, orgCount: orgCount || 0 };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; upgraded?: string }>;
}) {
  const params = await searchParams;
  const { activeGrants, orgCount } = await getGrantStats();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">GrantRadar</h1>
            <p className="text-xs text-muted-foreground">Free grant alerts for CA nonprofits</p>
          </div>
          <a href="/grants" className="text-sm text-primary hover:underline">
            Browse grants →
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        {/* Status banners */}
        {params.verified === "success" && (
          <div className="mb-8 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
            <p className="text-emerald-800 font-medium">Email verified! Your first grant digest arrives Monday.</p>
          </div>
        )}
        {params.verified === "already" && (
          <div className="mb-8 p-4 rounded-lg bg-blue-50 border border-blue-200 text-center">
            <p className="text-blue-800 font-medium">Your email is already verified. Digests arrive every Monday.</p>
          </div>
        )}
        {params.upgraded === "success" && (
          <div className="mb-8 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
            <p className="text-emerald-800 font-medium">Welcome to Pro! You now have AI fit scores and daily alerts.</p>
          </div>
        )}

        {/* Hero */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold tracking-tight mb-4 text-foreground">
            Know which grants are worth your time.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Every Monday, get a free email with CA state grants that match your nonprofit.
            Matched by category and geography. No login, no credit card, no catch.
          </p>
        </div>

        {/* Social proof bar */}
        <div className="flex flex-wrap justify-center gap-6 mb-12 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
            {activeGrants} active grants tracked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-primary"></span>
            Updated daily from CA Grants Portal
          </span>
          {orgCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-accent"></span>
              {orgCount} nonprofit{orgCount !== 1 ? "s" : ""} signed up
            </span>
          )}
        </div>

        {/* Signup form */}
        <SignupForm />

        {/* Digest preview */}
        <div className="mt-16 mb-16">
          <h3 className="text-center text-lg font-semibold mb-6">What your Monday email looks like</h3>
          <div className="max-w-lg mx-auto rounded-xl border bg-card p-6 shadow-sm">
            <div className="border-b pb-3 mb-3">
              <p className="font-bold text-sm">GrantRadar</p>
              <p className="text-xs text-muted-foreground">Your Nonprofit · Week of Apr 7, 2026 · 8 matching grants</p>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-bold text-amber-700">⏰ CLOSING SOON</p>
                <p className="text-sm font-medium mt-1">CA Arts Council: Arts & Cultural Organizations General Operating Relief</p>
                <p className="text-xs text-muted-foreground">Deadline: Jun 5, 2026 · Up to $150,000</p>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-bold text-primary">✨ NEW THIS WEEK</p>
                <p className="text-sm font-medium mt-1">Office of Historic Preservation: Heritage Fund Grant</p>
                <p className="text-xs text-muted-foreground">Deadline: Sep 30, 2026 · Up to $750,000</p>
              </div>
              <div className="border-t pt-3 text-xs text-muted-foreground">
                + 6 more matching grants...
              </div>
            </div>
          </div>
        </div>

        {/* Feature comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-bold mb-1">Free</h3>
            <p className="text-2xl font-bold mb-3">$0<span className="text-sm font-normal text-muted-foreground">/forever</span></p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">✓</span> Weekly grant digest every Monday</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">✓</span> Category + geography matching</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">✓</span> All {activeGrants}+ CA state grants</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">✓</span> Manage categories anytime</li>
            </ul>
          </div>
          <div className="rounded-xl border-2 border-primary bg-card p-6 relative">
            <span className="absolute -top-3 left-4 bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">COMING SOON</span>
            <h3 className="font-bold mb-1">Pro</h3>
            <p className="text-2xl font-bold mb-3">$19<span className="text-sm font-normal text-muted-foreground">/month</span></p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">✓</span> Everything in Free</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">✓</span> AI Fit Score (0-100) per grant</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">✓</span> AI grant narrative drafts</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">✓</span> Daily new-grant alerts</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Update signup form copy for free tier**

In `src/components/signup-form.tsx`, make these changes:

Change the success message from "You're in!" to include verification instruction:
```typescript
// Replace the success return block:
if (status === "success") {
    return (
      <Card className="max-w-lg mx-auto border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950">
        <CardContent className="p-8 text-center">
          <h3 className="text-xl font-bold text-emerald-800 dark:text-emerald-200">Check your email!</h3>
          <p className="mt-2 text-emerald-700 dark:text-emerald-300">
            We sent a verification link. Click it to start receiving your free weekly grant digest.
          </p>
        </CardContent>
      </Card>
    );
  }
```

Change the submit button text and footer:
```typescript
// Replace the Button component:
<Button type="submit" className="w-full" disabled={status === "loading" || selectedCategories.length === 0}>
  {status === "loading" ? "Signing up..." : "Get Free Weekly Digest"}
</Button>
<p className="text-xs text-center text-muted-foreground">
  Free forever. No credit card required.
</p>
```

- [ ] **Step 5: Wrap settings page in proper layout**

Replace `src/app/settings/page.tsx`:

```typescript
import { supabase } from "@/lib/supabase";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Invalid settings link</h2>
          <p className="text-muted-foreground">Check your email for a valid settings link.</p>
        </div>
      </div>
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, categories, geography_keywords, unsubscribe_token")
    .eq("unsubscribe_token", token)
    .single();

  if (!org) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Link expired or invalid</h2>
          <p className="text-muted-foreground">Check your email for a fresh settings link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold">GrantRadar</h1>
        </div>
      </header>
      <div className="max-w-lg mx-auto p-8">
        <h2 className="text-xl font-bold mb-4">Settings for {org.name}</h2>
        <SettingsForm
          token={token}
          initialCategories={org.categories}
          initialGeoKeywords={org.geography_keywords.join(", ")}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Block empty categories in settings form**

In `src/app/settings/settings-form.tsx`, add disabled state to the save button:

```typescript
// Replace the Button at the bottom:
<Button type="submit" className="w-full" disabled={categories.length === 0}>
  {saved ? "Saved!" : categories.length === 0 ? "Select at least one category" : "Save Changes"}
</Button>
```

- [ ] **Step 7: Wrap unsubscribe page in proper layout**

Replace `src/app/unsubscribe/page.tsx`:

```typescript
import { supabase } from "@/lib/supabase";
import { UnsubscribeConfirm } from "./unsubscribe-confirm";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Invalid unsubscribe link</h2>
          <p className="text-muted-foreground">Check your email for a valid unsubscribe link.</p>
        </div>
      </div>
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, subscription_status")
    .eq("unsubscribe_token", token)
    .single();

  if (!org) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Link expired or invalid</h2>
          <p className="text-muted-foreground">Check your email for a fresh unsubscribe link.</p>
        </div>
      </div>
    );
  }

  if (org.subscription_status === "cancelled") {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Already unsubscribed</h2>
          <p className="text-muted-foreground">{org.name} is already unsubscribed from GrantRadar.</p>
          <a href="/" className="text-primary hover:underline text-sm">Back to GrantRadar →</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold">GrantRadar</h1>
        </div>
      </header>
      <UnsubscribeConfirm token={token} orgName={org.name} />
    </div>
  );
}
```

- [ ] **Step 8: Verify build**

```bash
cd /Users/ender/code/grantradar && npm run build
```

Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/app/page.tsx src/components/signup-form.tsx src/app/settings/page.tsx src/app/settings/settings-form.tsx src/app/unsubscribe/page.tsx
git commit -m "feat: brand redesign — navy/teal theme, free tier messaging, HTML digest preview, trust signals"
```

---

### Task 9: Public Grant Listing Pages

**Files:**
- Create: `src/app/grants/page.tsx`
- Create: `src/app/grants/[id]/page.tsx`

- [ ] **Step 1: Create grants listing page**

```typescript
import { supabase } from "@/lib/supabase";
import Link from "next/link";

export const revalidate = 3600; // ISR: revalidate every hour

export default async function GrantsPage() {
  const { data: grants } = await supabase
    .from("grants")
    .select("id, title, agency, categories, application_deadline, deadline_date, est_amounts_text, status")
    .in("status", ["active", "forecasted"])
    .order("deadline_date", { ascending: true, nullsFirst: false });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <Link href="/" className="text-xl font-bold text-foreground hover:underline">GrantRadar</Link>
            <p className="text-xs text-muted-foreground">Free grant alerts for CA nonprofits</p>
          </div>
          <Link href="/" className="text-sm text-primary hover:underline">
            ← Sign up for alerts
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold mb-2">California State Grants</h2>
        <p className="text-muted-foreground mb-6">{grants?.length || 0} active grants from the CA Grants Portal</p>

        <div className="space-y-3">
          {(grants || []).map((grant) => {
            const isClosingSoon = grant.deadline_date && new Date(grant.deadline_date) <= new Date(Date.now() + 14 * 86400000);
            return (
              <Link
                key={grant.id}
                href={`/grants/${grant.id}`}
                className="block rounded-lg border bg-card p-4 hover:border-primary transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{grant.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {grant.agency || "Unknown Agency"} · {grant.application_deadline || "Ongoing"}
                      {grant.est_amounts_text ? ` · ${grant.est_amounts_text}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(grant.categories || []).slice(0, 3).map((cat: string) => (
                        <span key={cat} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                          {cat}
                        </span>
                      ))}
                      {(grant.categories || []).length > 3 && (
                        <span className="text-xs text-muted-foreground">+{grant.categories.length - 3}</span>
                      )}
                    </div>
                  </div>
                  {isClosingSoon && (
                    <span className="shrink-0 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                      Closing soon
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create grant detail page**

```typescript
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { notFound } from "next/navigation";

export const revalidate = 3600;

export default async function GrantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: grant } = await supabase
    .from("grants")
    .select("*")
    .eq("id", id)
    .single();

  if (!grant) notFound();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-foreground hover:underline">GrantRadar</Link>
          <Link href="/grants" className="text-sm text-primary hover:underline">← All grants</Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">{grant.title}</h1>
        <p className="text-muted-foreground mb-6">{grant.agency || "Unknown Agency"}</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Deadline</p>
            <p className="font-medium">{grant.application_deadline || "Ongoing"}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Estimated Amount</p>
            <p className="font-medium">{grant.est_amounts_text || "Not specified"}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="font-medium capitalize">{grant.status}</p>
          </div>
        </div>

        {grant.purpose && (
          <div className="mb-6">
            <h2 className="font-bold mb-2">Purpose</h2>
            <p className="text-muted-foreground text-sm">{grant.purpose}</p>
          </div>
        )}

        {grant.description && (
          <div className="mb-6">
            <h2 className="font-bold mb-2">Description</h2>
            <p className="text-muted-foreground text-sm whitespace-pre-line">{grant.description}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {grant.categories && grant.categories.length > 0 && (
            <div>
              <h2 className="font-bold mb-2">Categories</h2>
              <div className="flex flex-wrap gap-1">
                {grant.categories.map((cat: string) => (
                  <span key={cat} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{cat}</span>
                ))}
              </div>
            </div>
          )}
          {grant.applicant_types && grant.applicant_types.length > 0 && (
            <div>
              <h2 className="font-bold mb-2">Eligible Applicants</h2>
              <div className="flex flex-wrap gap-1">
                {grant.applicant_types.map((t: string) => (
                  <span key={t} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {grant.geography_text && (
          <div className="mb-6">
            <h2 className="font-bold mb-2">Geography</h2>
            <p className="text-muted-foreground text-sm">{grant.geography_text}</p>
          </div>
        )}

        {grant.grant_url && (
          <a
            href={grant.grant_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            View on CA Grants Portal →
          </a>
        )}

        <div className="mt-12 rounded-lg border bg-card p-6 text-center">
          <h3 className="font-bold mb-2">Get grants like this in your inbox every Monday</h3>
          <p className="text-sm text-muted-foreground mb-4">Free. Matched to your nonprofit's categories and geography.</p>
          <Link href="/" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Sign up free →
          </Link>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/ender/code/grantradar && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/grants/page.tsx src/app/grants/\[id\]/page.tsx
git commit -m "feat: add public grant listing and detail pages with ISR caching"
```

---

### Task 10: Deploy + Verify

**Files:**
- Modify: `vercel.json` (add daily Pro cron placeholder)

- [ ] **Step 1: Run the full build one final time**

```bash
cd /Users/ender/code/grantradar && npm run build
```

Expected: Build succeeds with all new routes compiled.

- [ ] **Step 2: Apply database migration**

Run the migration against the live Supabase instance. Use MCP `apply_migration` or execute the SQL directly in the Supabase dashboard SQL editor at `https://supabase.com/dashboard/project/ppsexpgopqzshkcknxqt/sql`.

- [ ] **Step 3: Push and deploy**

```bash
cd /Users/ender/code/grantradar && git push origin main
```

Vercel will auto-deploy from the push.

- [ ] **Step 4: Run initial grant sync**

```bash
source ~/.claude/.env
curl -H "Authorization: Bearer ${CRON_SECRET}" https://grantradar-sable.vercel.app/api/sync-grants
```

Expected: JSON response with `fetched` > 50, `upserted` > 0.

- [ ] **Step 5: Verify live site**

Check these URLs after deployment completes:
- `https://grantradar-sable.vercel.app/` — landing page with new design
- `https://grantradar-sable.vercel.app/grants` — grant listing (populated after sync)
- Rate limit: hit `/api/signup` 25 times rapidly — should get 429 after 20

- [ ] **Step 6: Commit vercel.json if changed**

Only if any cron changes were needed during deployment.
