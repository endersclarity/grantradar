# GrantRadar Architecture

## System Diagram

```mermaid
flowchart TD
    subgraph DATA_SOURCES["Data Sources"]
        CAPortal["CA Grants Portal\n(data.ca.gov CSV)\n~160 active grants"]
        ProPublica["ProPublica API\n(IRS 990 / NTEE data)\nFree, no auth"]
    end

    subgraph INGESTION["Ingestion Layer"]
        SyncCron["Grant Sync Cron\n/api/sync-grants\nDaily CSV fetch + upsert"]
        EINLookup["EIN Lookup\n/api/lookup-ein\nOrg name, NTEE, revenue"]
    end

    subgraph STORAGE["Supabase (Postgres)"]
        Grants["grants table\n~1,874 rows\nportal_id, title, purpose,\ndescription, categories,\ndeadline_date, amounts"]
        Orgs["organizations table\nname, email, categories,\nmission_keywords, min_grant_amount,\ngeography_keywords"]
        Digests["digests table\norg_id, grant_count,\nsent_at"]
    end

    subgraph MATCHING["Matching Engine"]
        CatFilter["Category Filter\n(hard: overlap required)"]
        GeoFilter["Geography Filter\n(soft: statewide included)"]
        AmountFilter["Amount Filter\n(skip if below min)"]
        KeywordScore["Keyword Relevance Scorer\ntitle: +50\npurpose: +30\ndescription: +20"]
        Sectioner["Section Classifier\nclosing_soon (≤14d)\nnew_this_week (≤7d)\nall_matching"]
        Sorter["Sort: section → relevance DESC → deadline ASC"]
    end

    subgraph DELIVERY["Delivery Layer"]
        DigestCron["/api/send-digests\nMonday cron"]
        Resend["Resend Email API\nHTML + plain text"]
        EmailTemplate["Email Template\nmatch reason tags\ndeadline context\nupgrade banner"]
    end

    subgraph FRONTEND["Next.js 16 Frontend"]
        Homepage["Landing Page\nEIN lookup → auto-fill\nSignup form"]
        GrantsList["Grants Listing\n/grants\n25/page pagination\ncategory filter"]
        GrantDetail["Grant Detail\n/grants/[id]"]
        Settings["Settings Page\ntoken-auth\ncategories, keywords,\nmin amount, geography"]
        Unsubscribe["Unsubscribe\nconfirmation flow"]
    end

    subgraph PAYMENTS["Payments (Stub)"]
        Stripe["Stripe Checkout\ntest mode\n$19/mo Pro tier\n(COMING SOON)"]
    end

    CAPortal -->|Daily CSV| SyncCron
    SyncCron -->|Upsert| Grants
    ProPublica -->|EIN query| EINLookup
    EINLookup -->|Auto-fill| Homepage

    Homepage -->|POST /api/signup| Orgs
    Settings -->|POST /api/settings| Orgs

    DigestCron -->|Fetch verified orgs| Orgs
    DigestCron -->|For each org| CatFilter
    Grants -->|All active/forecasted| CatFilter
    CatFilter --> GeoFilter --> AmountFilter --> KeywordScore --> Sectioner --> Sorter
    Sorter -->|MatchedGrant[]| EmailTemplate
    EmailTemplate --> Resend
    Resend -->|Email to org| Digests

    Homepage --> GrantsList --> GrantDetail
    Stripe -.->|Future| Orgs
```

## Current State (2026-04-11)

| Metric | Value |
|--------|-------|
| Data sources | CA Grants Portal + Grants.gov API + Candid Premium (2 downloads) |
| Grants in DB | 1,144 (100% AI-classified) |
| Funders in DB | 648 (100% AI-classified, fit-scored 0-100) |
| Candid downloads used | ~1,544 of 5,000/month |
| Orgs signed up | 1 (test) |
| Revenue | $0 |
| Pro tier | Stub (coming soon badge) |
| RLS | Enabled on all tables (migration 006) |
| AI features | Grant classification (agency/category patterns), Funder fit scoring (rule-based: subject + geography + foundation type) |

## Database Tables

| Table | Records | Source | Key Columns |
|-------|---------|--------|-------------|
| grants | 1,144 | Grants.gov API + CA Grants CSV | title, agency, synopsis, ai_tags, ai_summary, ai_classified_at |
| organizations | 1 | Signup form | name, email, categories, mission_keywords |
| digests | 0 | Send-digest cron | org_id, grant_count, sent_at |
| funders | 648 | Candid Premium CSV | name, ein, subject_areas, mission_statement, total_assets, ai_fit_score, ai_tags |

## What Actually Works
1. Daily CSV sync from CA portal → Supabase
2. Grants.gov API ingestor (search2 + fetchOpportunity, unauthenticated)
3. EIN lookup → auto-fills org profile from IRS data
4. Keyword relevance scoring in matching engine
5. Weekly email digest with match reasons + deadline context
6. Settings management via token auth (no passwords)
7. Pagination, date formatting, mobile responsive
8. Grant classification — 100% coverage via auto-classify pipeline
9. Funder ingest + classification — Candid CSV → candid_ingest.py → funder_classify.py
10. RLS on all tables (anon key can only read grants + funders)
11. Cross-reference against NSH Notion data (9/131 overlap on first download)

## What Doesn't Exist Yet
1. Automated recurring sync (Grants.gov incremental by date, CA Grants CSV diff)
2. Funder-to-grant relationship table (which funder gave which grant)
3. Admin dashboard as real Next.js route (mockup at ~/vault/dev/grantradar-admin-dashboard.html)
4. AI fit scoring exposed in web UI (Pro tier feature — data exists in Supabase)
5. AI grant narrative drafts (Pro tier feature)
6. Grant bookmarking / pipeline tracking
7. Dashboard (authenticated browse experience)
8. Any paying customers
9. SPF/DKIM for email deliverability (needs grantradar.com DNS)
10. Stripe repricing ($49→$19)

## Development Timeline

| Date | Milestone |
|------|-----------|
| 2026-04-03 | Conceived after Zenvoice failed forcing questions. Design doc + 3 adversarial review rounds. |
| 2026-04-04 | Built from zero to deployed in one day. V1 at $49/mo. Pivoted to free+$19/mo Pro. |
| 2026-04-05 | Phase A deployed. Pipeline expansion spec (7 reviews). CA sync bug found (closing federal grants). |
| 2026-04-06 | Federal ingestor + AI classification shipped. /grants skill + /devcock created. Candid Premium access confirmed. |
| 2026-04-07 | Admin dashboard mockup. Candid: 767 broad + 134 refined prospect downloads. Classification backfill started (8.9%). |
| 2026-04-11 | Classification backfill completed (100%). RLS migration 006 + funders table 007 applied via Supabase MCP. 131 Candid funders ingested + classified. Cross-referenced against all Notion sources (121 new). Second Candid download: 643 arts/culture + women's rights funders. Total: 648 funders, all classified. flush.py hardened (hash-based change detection, programmatic merge). |
