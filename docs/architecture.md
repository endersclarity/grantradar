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

## Current State (2026-04-05)

| Metric | Value |
|--------|-------|
| Data sources | CA Grants Portal + Grants.gov |
| Active grants | ~160 CA + ~2,800 federal |
| Total grants in DB | ~4,700+ |
| Orgs signed up | 1 (test) |
| Revenue | $0 |
| Pro tier | Stub (coming soon badge) |
| AI features | AI tag classification (via Claude Code) |

## What Actually Works
1. Daily CSV sync from CA portal → Supabase
2. EIN lookup → auto-fills org profile from IRS data
3. Keyword relevance scoring in matching engine
4. Weekly email digest with match reasons + deadline context
5. Settings management via token auth (no passwords)
6. Pagination, date formatting, mobile responsive

## What Doesn't Exist Yet
1. AI fit scoring (Pro tier feature)
2. AI grant narrative drafts (Pro tier feature)
3. Multiple data sources (federal, private foundations)
4. Grant bookmarking / pipeline tracking
5. Dashboard (authenticated browse experience)
6. Any paying customers
7. SPF/DKIM for email deliverability
