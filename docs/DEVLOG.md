# GrantRadar Development Log

Narrative record of what was built, why, and what changed. Append new entries at the bottom.

---

## 2026-04-03 — Day 0: Birth from a dead idea

GrantRadar exists because Zenvoice died. Kaelen was building an invoicing app and ran it through YC office-hours forcing questions — the kind that ask "who is desperate for this?" The answer was nobody. Zenvoice got killed on the spot.

Same session, pivoted to the real pain: Kaelen spends hours every week hunting for grants for NorthstarHouse, a historic Julia Morgan house in Grass Valley. Small nonprofits can't afford Instrumentl ($179/mo). The state publishes grant data as a free CSV. There's a product in the gap.

Design doc written. Three rounds of adversarial review (scored 3/10 → 5/10 → 6/10). Ten-task implementation plan with exact file paths. Codex challenge scored it 8/10.

## 2026-04-04 — Day 1: Zero to deployed

Built the entire app in one day. Next.js 16, Supabase, Resend, Stripe, Vercel. CA Grants Portal CSV sync, EIN lookup via ProPublica, keyword relevance scoring, weekly email digests, settings page with token auth.

V1 launched at $49/mo. Immediately realized that's wrong — grants.ca.gov sends free email alerts with the same data. Pivoted to free discovery tier + $19/mo Pro (AI fit scoring + narrative drafts). V2 deployed same day with new brand, 1,874 grants, pagination, category filtering.

## 2026-04-05 — Day 2: Federal money and pipeline vision

Phase A deployed to production. Added Grants.gov API ingestor — unauthenticated, free, federal money. Pipeline expansion spec written with 7 review rounds. Found a critical bug: CA sync was closing all federal grants every run (wrong query scope).

Bigger realization: GrantRadar shouldn't just scrape CA. It should be a unified multi-source system. One Supabase backend, two frontends (web dashboard for paying users, Claude Code /grants skill for Kaelen). Architecture decision documented.

Three-tier source classification established:
- Tier 1 (APIs): Grants.gov, CA Portal
- Tier 2 (Scrapable niche): CA Arts Council, NTHP, 1772 Foundation, Getty
- Tier 3 (Human only): Candid, Instrumentl, GrantStation

## 2026-04-06 — Day 3: Classification and Candid

Federal ingestor + AI classification shipped. Created /grants command and /devcock skill. Confirmed Candid Premium access via NSH's Platinum Seal of Transparency (development@thenorthstarhouse.org, 5,000 downloads/month).

Security sprint: POST-only unsubscribe, input validation, CSRF protection. RLS migration written but couldn't apply — Supabase REST API doesn't support DDL.

## 2026-04-07 — Day 4: Candid deep dive and admin vision

Two Candid downloads: 767 broad grantmakers (6 filters) and 134 refined prospects (added "accepting applications" + "Location: California"). Key insight: the "Grantmaker applications: exclude not accepting unsolicited" filter is what separates actionable prospects from noise.

Admin dashboard designed — ops view with Sync CA, Sync Federal, Classify, Send Digest buttons, pipeline health stats, activity log, grant table, Candid import panel. HTML mockup only.

Grant classification backfill started: 101 of 1,141 (8.9%). Script uses inline Claude Code, not API — no Anthropic API key needed.

Funder data is fundamentally different from grant data. Funders are organizations that GIVE grants. Needs its own table schema with financials, leadership, mission statements, AI fit scoring.

## 2026-04-11 — Day 5: The data layer grows up

### Morning: Unblocked

Supabase MCP finally working. Applied RLS migration (006) — anon key can now only read grants and funders, everything else blocked. Applied funders table migration (007) — full schema with EIN, financials, subject areas, AI classification columns.

Grant classification backfill completed: 8.8% → 100% in one session (1,043 grants classified via agency/category pattern matching). No more manual classification needed — future syncs classify inline.

### Midday: Funder pipeline

Built `candid_ingest.py` (CSV upsert by EIN) and `funder_classify.py` (rule-based scoring: subject area keywords + geographic proximity to Nevada County + foundation type). Ingested 131 Candid funders from the April 7 refined download. All classified.

Cross-referenced against ALL NSH Notion sources (Funders, Grants, Correspondence, Research, Partnership Leads — 156 unique references). Only 9 overlap. 121 are genuinely new prospects NSH never tracked.

Top new leads: North Valley Community Foundation (Butte, adjacent county), California Missions Foundation (pure preservation), The Candelaria Fund (Mendocino), Bertha Russ Lytel Foundation (Humboldt).

### Afternoon: Broadening the search

Expanded Candid search beyond "Historic preservation" to "Arts and culture + Women's rights" — catching funders who'd fund arts programming at a historic venue but don't tag themselves as preservation funders. NSH's NR amendment (nationally significant for women's history and civil rights) makes this relevant.

643 grantmakers returned. Downloaded, ingested, classified. Total funders in Supabase: 648 (all classified, fit-scored 0-100). After dedup, 517 net new from the arts/culture download.

New top leads from expanded search: Setzer Foundation (Sacramento, preservation + arts), Sierra Pacific Foundation (Sacramento), Tahoe Truckee Community Foundation (very close to NSH), Hind Foundation (already recommended by Elissa Brown from SNC).

Organized ~/code/starhouse/ — moved loose Candid CSVs to data/candid/, archived raw Notion export, merged duplicate youtube folders.

### Infrastructure hardened

- Knowledge flush script: replaced LLM-based merge with programmatic append (10 claude -p calls → 1 per log). Added hash-based change detection so growing logs get re-processed. History entry dedup prevents duplicates on re-runs.
- Chrome DevTools MCP: root-caused recurring breakage (--autoConnect defaults to sandbox profile, plugin updates overwrite the fix). Documented at dev/chrome-devtools-mcp-recurring-breakage.md.

### What this means for the product

GrantRadar now has two real data tables. 1,144 classified grants + 648 classified funders. The funder data enables the Pro tier feature (AI fit scoring) — the scores exist, they just need a UI. No automated sync yet for any source. Stripe still says $49/mo.
