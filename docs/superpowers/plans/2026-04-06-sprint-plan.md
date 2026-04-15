# GrantRadar Sprint: AI Classification + Weekly Federal Sync

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change federal sync to weekly Sunday, build AI grant classification using Claude Haiku, create a `/grants` command for the second brain, backfill all existing grants, and deploy.

**Architecture:** GrantRadar (Next.js on Vercel + Supabase) is the data warehouse. Claude Code is the intelligence layer. Classification runs locally via a Python script (`~/.claude/scripts/grant_classify.py`) that calls the Anthropic API and writes results back to Supabase. No Anthropic API key in Vercel. The `/grants` command (`~/.claude/commands/grants.md`) orchestrates queries and triggers classification.

**Tech Stack:** Next.js 16, Supabase (Postgres), Vercel cron, Python 3 (anthropic + supabase-py), Claude Haiku (claude-haiku-4-5-20251001)

**Repo:** `~/code/grantradar/`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `~/code/grantradar/vercel.json` | Modify | Change federal sync cron to weekly Sunday |
| `~/.claude/scripts/grant_classify.py` | Create | Python script: query unclassified grants from Supabase, classify with Haiku, write back ai_tags + ai_summary |
| `~/.claude/commands/grants.md` | Create | Claude Code command: query grant pipeline, trigger classification, display results |
| `~/.claude/scripts/.venv/` | Modify | Install `supabase` and `anthropic` Python packages |

---

### Task 1: Merge feature/pipeline-expansion remnants and clean up

**Files:**
- Modify: `~/code/grantradar/vercel.json`

The feature branch is essentially merged into main already (only 3-4 lines of trivial diff remain). This task reconciles the branch and updates the cron schedule.

- [ ] **Step 1: Check diff between main and feature/pipeline-expansion**

```bash
cd ~/code/grantradar && git diff main..feature/pipeline-expansion --stat
```

Expected: 3 files, ~4 insertions/3 deletions (trivial).

- [ ] **Step 2: Merge the branch**

```bash
cd ~/code/grantradar && git merge feature/pipeline-expansion --no-ff -m "chore: merge pipeline-expansion branch into main

Incorporates remaining diff from feature/pipeline-expansion.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Change federal sync cron to weekly Sunday**

In `~/code/grantradar/vercel.json`, change the sync-federal schedule from daily to weekly Sunday at 14:00 UTC (6 AM PT):

```json
{
  "crons": [
    {
      "path": "/api/sync-grants",
      "schedule": "0 13 * * *"
    },
    {
      "path": "/api/sync-federal",
      "schedule": "0 14 * * 0"
    },
    {
      "path": "/api/send-digests",
      "schedule": "50 14 * * 1"
    }
  ]
}
```

The only change is `"0 14 * * *"` → `"0 14 * * 0"` (Sunday only).

- [ ] **Step 4: Commit**

```bash
cd ~/code/grantradar
git add vercel.json
git commit -m "chore: change federal sync cron to weekly Sunday

Reduces API load — weekly is sufficient for federal grant monitoring.
Schedule: Sundays at 14:00 UTC (6 AM PT), one day before Monday digest.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Delete the feature branch (cleanup)**

```bash
cd ~/code/grantradar
git branch -d feature/pipeline-expansion
rm -rf .worktrees/pipeline-expansion
```

---

### Task 2: Install Python dependencies

**Files:**
- Modify: `~/.claude/scripts/.venv/`

- [ ] **Step 1: Install supabase and anthropic packages**

```bash
source ~/.claude/scripts/.venv/bin/activate && pip install supabase anthropic
```

Expected: Both packages install successfully. `supabase` pulls in `postgrest`, `gotrue`, etc. `anthropic` pulls in `httpx`, `pydantic`, etc.

- [ ] **Step 2: Verify imports work**

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 -c "from supabase import create_client; from anthropic import Anthropic; print('OK')"
```

Expected: `OK`

---

### Task 3: Build grant classification script

**Files:**
- Create: `~/.claude/scripts/grant_classify.py`

This script queries Supabase for unclassified grants, sends them to Claude Haiku in batches, and writes ai_tags + ai_summary back. It's called by the `/grants` command or run standalone.

- [ ] **Step 1: Create the classification script**

Create `~/.claude/scripts/grant_classify.py`:

```python
#!/usr/bin/env python3
"""Classify grants using Claude Haiku. Populates ai_tags, ai_summary, ai_classified_at.

Usage:
    python3 grant_classify.py                  # classify up to 50 unclassified grants
    python3 grant_classify.py --limit 200      # classify up to 200
    python3 grant_classify.py --backfill       # classify ALL unclassified grants (batches of 50)
    python3 grant_classify.py --stats          # show classification stats only
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from anthropic import Anthropic
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

MODEL = "claude-haiku-4-5-20251001"

CLASSIFICATION_PROMPT = """You are classifying a grant opportunity for relevance to nonprofit organizations focused on historic preservation, museums, arts, and community development.

Given this grant:
Title: {title}
Agency: {agency}
Synopsis: {synopsis}
Eligibility: {eligibility}
Categories: {categories}
Award: {award_range}

Generate:
1. tags: An array of 3-8 theme tags from this list (use ONLY these tags, pick all that apply):
   "historic preservation", "cultural heritage", "museum collections", "architectural preservation",
   "heritage tourism", "adaptive reuse", "arts education", "community development",
   "rural infrastructure", "capacity building", "cultural resources", "humanities",
   "archives", "interpretive programs", "ADA accessibility", "public history",
   "environmental education", "youth programs", "workforce development", "public safety",
   "housing", "economic development", "transportation", "agriculture",
   "health services", "technology", "science research", "disaster relief",
   "veterans services", "food security", "energy", "water resources",
   "law enforcement", "consumer protection", "education general", "library services"
2. summary: One sentence (under 150 chars) describing what this grant funds and who it's for.

Return valid JSON only: {{"tags": [...], "summary": "..."}}"""


def get_clients():
    """Initialize Supabase and Anthropic clients."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        # Try loading from dotenv file
        env_path = os.path.expanduser("~/.claude/.env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        key, val = line.split("=", 1)
                        os.environ.setdefault(key.strip(), val.strip())

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")

    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_KEY (or NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) must be set.", file=sys.stderr)
        print("Check ~/.claude/.env or ~/code/grantradar/.env.local", file=sys.stderr)
        sys.exit(1)

    if not api_key:
        print("Error: ANTHROPIC_API_KEY must be set.", file=sys.stderr)
        sys.exit(1)

    sb = create_client(url, key)
    anthropic = Anthropic(api_key=api_key)
    return sb, anthropic


def fetch_unclassified(sb, limit: int):
    """Fetch grants that haven't been classified yet."""
    result = (
        sb.table("grants")
        .select("id, title, agency, synopsis, eligibility, categories, award_floor, award_ceiling, est_amounts_text")
        .is_("ai_classified_at", "null")
        .in_("status", ["active", "forecasted"])
        .limit(limit)
        .execute()
    )
    return result.data or []


def classify_grant(anthropic_client, grant: dict) -> dict | None:
    """Classify a single grant using Claude Haiku."""
    award_range = grant.get("est_amounts_text") or ""
    if not award_range and (grant.get("award_floor") or grant.get("award_ceiling")):
        floor = grant.get("award_floor") or 0
        ceiling = grant.get("award_ceiling") or 0
        if ceiling:
            award_range = f"${floor:,} - ${ceiling:,}"

    prompt = CLASSIFICATION_PROMPT.format(
        title=grant.get("title") or "Unknown",
        agency=grant.get("agency") or "Unknown",
        synopsis=(grant.get("synopsis") or "")[:500],
        eligibility=(grant.get("eligibility") or "")[:300],
        categories=", ".join(grant.get("categories") or []),
        award_range=award_range or "Not specified",
    )

    try:
        response = anthropic_client.messages.create(
            model=MODEL,
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()

        # Parse JSON from response (handle markdown code blocks)
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        parsed = json.loads(text)
        return {
            "tags": parsed.get("tags", []),
            "summary": parsed.get("summary", "")[:200],
        }
    except (json.JSONDecodeError, IndexError, KeyError) as e:
        print(f"  Parse error for grant {grant['id']}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  API error for grant {grant['id']}: {e}", file=sys.stderr)
        return None


def write_classification(sb, grant_id: str, classification: dict):
    """Write classification results back to Supabase."""
    sb.table("grants").update({
        "ai_tags": classification["tags"],
        "ai_summary": classification["summary"],
        "ai_classified_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", grant_id).execute()


def show_stats(sb):
    """Show classification statistics."""
    total = sb.table("grants").select("id", count="exact").in_("status", ["active", "forecasted"]).execute()
    classified = sb.table("grants").select("id", count="exact").in_("status", ["active", "forecasted"]).not_.is_("ai_classified_at", "null").execute()
    unclassified = sb.table("grants").select("id", count="exact").in_("status", ["active", "forecasted"]).is_("ai_classified_at", "null").execute()

    total_count = total.count or 0
    classified_count = classified.count or 0
    unclassified_count = unclassified.count or 0

    print(f"Total active/forecasted grants: {total_count}")
    print(f"Classified: {classified_count}")
    print(f"Unclassified: {unclassified_count}")
    if total_count > 0:
        print(f"Coverage: {classified_count / total_count * 100:.1f}%")


def main():
    parser = argparse.ArgumentParser(description="Classify grants using Claude Haiku")
    parser.add_argument("--limit", type=int, default=50, help="Max grants to classify per run (default: 50)")
    parser.add_argument("--backfill", action="store_true", help="Classify ALL unclassified grants in batches")
    parser.add_argument("--stats", action="store_true", help="Show classification stats only")
    args = parser.parse_args()

    sb, anthropic_client = get_clients()

    if args.stats:
        show_stats(sb)
        return

    batch_size = args.limit
    total_classified = 0
    total_failed = 0

    while True:
        grants = fetch_unclassified(sb, batch_size)
        if not grants:
            if total_classified == 0:
                print("No unclassified grants found.")
            break

        print(f"Classifying {len(grants)} grants...")

        for i, grant in enumerate(grants):
            classification = classify_grant(anthropic_client, grant)
            if classification:
                write_classification(sb, grant["id"], classification)
                total_classified += 1
                if (i + 1) % 10 == 0:
                    print(f"  Progress: {i + 1}/{len(grants)} ({total_classified} total classified)")
            else:
                total_failed += 1

        if not args.backfill:
            break

        print(f"Batch complete. Classified: {total_classified}, Failed: {total_failed}. Fetching next batch...")

    print(f"\nDone. Classified: {total_classified}, Failed: {total_failed}")
    show_stats(sb)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Make executable**

```bash
chmod +x ~/.claude/scripts/grant_classify.py
```

- [ ] **Step 3: Verify it loads without errors**

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 ~/.claude/scripts/grant_classify.py --help
```

Expected:
```
usage: grant_classify.py [-h] [--limit LIMIT] [--backfill] [--stats]
```

- [ ] **Step 4: Test stats mode (reads from Supabase, no writes)**

You need env vars set. Check if `~/.claude/.env` or `~/code/grantradar/.env.local` has `SUPABASE_URL`/`SUPABASE_KEY` and `ANTHROPIC_API_KEY`. If not, set them:

```bash
# Load env vars from grantradar's .env.local
export NEXT_PUBLIC_SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL ~/code/grantradar/.env.local | cut -d= -f2)
export SUPABASE_SERVICE_ROLE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ~/code/grantradar/.env.local | cut -d= -f2)
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY ~/.claude/.env 2>/dev/null | cut -d= -f2 || echo "NEEDS_TO_BE_SET")
```

Then run:

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 ~/.claude/scripts/grant_classify.py --stats
```

Expected: Prints total, classified (0), unclassified (all), coverage (0%).

- [ ] **Step 5: Test single grant classification (limit 1)**

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 ~/.claude/scripts/grant_classify.py --limit 1
```

Expected: Classifies 1 grant, prints "Done. Classified: 1, Failed: 0", then shows updated stats.

- [ ] **Step 6: Verify the classification in Supabase**

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 -c "
from supabase import create_client
import os
sb = create_client(os.environ['NEXT_PUBLIC_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
r = sb.table('grants').select('id, title, ai_tags, ai_summary, ai_classified_at').not_.is_('ai_classified_at', 'null').limit(1).execute()
for g in r.data:
    print(f'Title: {g[\"title\"]}')
    print(f'Tags: {g[\"ai_tags\"]}')
    print(f'Summary: {g[\"ai_summary\"]}')
    print(f'Classified: {g[\"ai_classified_at\"]}')
"
```

Expected: Shows the grant with populated ai_tags (3-8 tags), ai_summary (one sentence), and ai_classified_at (timestamp).

- [ ] **Step 7: Commit**

```bash
cd ~/.claude/scripts
git add grant_classify.py
git commit -m "feat: add grant classification script using Claude Haiku

Classifies grants with ai_tags and ai_summary via Anthropic API.
Supports --limit, --backfill, and --stats modes.
Reads Supabase credentials from env vars or ~/.claude/.env.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

Note: This file lives in `~/.claude/scripts/` which may not be in the grantradar repo. If it's in a separate repo or untracked, adjust accordingly. The important thing is the file exists and works.

---

### Task 4: Create /grants Claude Code command

**Files:**
- Create: `~/.claude/commands/grants.md`

This command lets Kaelen query the grant pipeline from any directory. It triggers classification for unclassified grants and displays results grouped by section.

- [ ] **Step 1: Create the grants command**

Create `~/.claude/commands/grants.md`:

```markdown
---
description: Query the GrantRadar grant pipeline, classify unclassified grants, and show relevant opportunities.
allowed-tools: Bash, Read
---

# /grants — Grant Pipeline Dashboard

Query the GrantRadar pipeline and classify new grants.

## Arguments

$ARGUMENTS is optional. If provided, filter results by keyword. If "--classify" is passed, run classification on unclassified grants. If "--stats" is passed, show stats only.

## Steps

### 1. Load environment

Load Supabase and Anthropic credentials:

```bash
export NEXT_PUBLIC_SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL ~/code/grantradar/.env.local | cut -d= -f2)
export SUPABASE_SERVICE_ROLE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ~/code/grantradar/.env.local | cut -d= -f2)
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY ~/.anthropic/.env 2>/dev/null | cut -d= -f2 || grep ANTHROPIC_API_KEY ~/.claude/.env 2>/dev/null | cut -d= -f2)
```

### 2. Check for unclassified grants

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 ~/.claude/scripts/grant_classify.py --stats
```

If there are unclassified grants, tell the user and ask if they want to classify them. If `$ARGUMENTS` contains "--classify", run classification automatically:

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 ~/.claude/scripts/grant_classify.py --limit 50
```

### 3. Query the pipeline

Run this Python snippet to pull pipeline data:

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 -c "
import os, json
from datetime import datetime, timedelta
from supabase import create_client

sb = create_client(os.environ['NEXT_PUBLIC_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])

now = datetime.utcnow()
seven_days_ago = (now - timedelta(days=7)).isoformat()
fourteen_days = (now + timedelta(days=14)).strftime('%Y-%m-%d')
today = now.strftime('%Y-%m-%d')

# NSH preservation keywords
KEYWORDS = ['historic preservation', 'cultural heritage', 'museum', 'preservation', 'heritage', 'arts', 'humanities', 'archive', 'historic']

# Fetch active grants
r = sb.table('grants').select('id, title, agency, source, deadline_date, first_seen_at, ai_tags, ai_summary, award_ceiling, grant_url').in_('status', ['active', 'forecasted']).execute()
grants = r.data or []

# Filter for NSH relevance: ai_tags overlap OR title keyword match
def is_relevant(g):
    tags = g.get('ai_tags') or []
    title = (g.get('title') or '').lower()
    for kw in KEYWORDS:
        if any(kw in t.lower() for t in tags):
            return True
        if kw in title:
            return True
    return False

relevant = [g for g in grants if is_relevant(g)]

# Section
closing_soon = [g for g in relevant if g.get('deadline_date') and g['deadline_date'] <= fourteen_days and g['deadline_date'] >= today]
new_this_week = [g for g in relevant if g.get('first_seen_at') and g['first_seen_at'] >= seven_days_ago and g not in closing_soon]
rest = [g for g in relevant if g not in closing_soon and g not in new_this_week]

closing_soon.sort(key=lambda g: g.get('deadline_date') or '9999')
new_this_week.sort(key=lambda g: g.get('first_seen_at') or '', reverse=True)

print(json.dumps({
    'total_active': len(grants),
    'total_relevant': len(relevant),
    'closing_soon': closing_soon[:10],
    'new_this_week': new_this_week[:10],
    'other_relevant': rest[:10],
    'sources': {s: len([g for g in grants if g.get('source') == s]) for s in set(g.get('source','unknown') for g in grants)},
    'unclassified': len([g for g in grants if not g.get('ai_tags')]),
}, default=str, indent=2))
"
```

### 4. Present results

Format the output as a clear dashboard:

**Pipeline Overview:**
- Total active grants: X (Y from CA portal, Z from Grants.gov)
- Relevant to NSH: X
- Unclassified: X (offer to classify if > 0)

**Closing Soon (next 14 days):**
- List with title, agency, deadline, award ceiling, grant URL

**New This Week:**
- List with title, agency, first seen date, AI summary

**Other Relevant:**
- List with title, agency, AI summary

If `$ARGUMENTS` contains a search term (not a flag), filter all results by that term in title or ai_tags.
```

- [ ] **Step 2: Test the command**

In Claude Code, run:

```
/grants --stats
```

Expected: Shows pipeline statistics.

- [ ] **Step 3: Test with full query**

```
/grants
```

Expected: Shows pipeline dashboard with sections.

---

### Task 5: Backfill AI classification on all existing grants

**Files:**
- None (uses script from Task 3)

This runs the classification script in backfill mode against all ~4,700 existing grants. Estimated cost: ~$5 at Haiku rates.

- [ ] **Step 1: Check current stats**

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 ~/.claude/scripts/grant_classify.py --stats
```

Expected: Shows total count and 0% (or near 0%) classification coverage.

- [ ] **Step 2: Run backfill**

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 ~/.claude/scripts/grant_classify.py --backfill
```

This processes all unclassified grants in batches of 50. Takes ~15-30 minutes for ~4,700 grants (API rate dependent). Monitor progress in output.

- [ ] **Step 3: Verify coverage**

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 ~/.claude/scripts/grant_classify.py --stats
```

Expected: ~100% coverage (some may fail on parse errors, that's fine if < 5%).

- [ ] **Step 4: Spot-check 5 classified grants**

```bash
source ~/.claude/scripts/.venv/bin/activate && python3 -c "
import os
from supabase import create_client
sb = create_client(os.environ['NEXT_PUBLIC_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
r = sb.table('grants').select('title, ai_tags, ai_summary').not_.is_('ai_classified_at', 'null').limit(5).execute()
for g in r.data:
    print(f'Title: {g[\"title\"]}')
    print(f'Tags: {g[\"ai_tags\"]}')
    print(f'Summary: {g[\"ai_summary\"]}')
    print()
"
```

Expected: Tags make sense for each grant. Summaries are concise and accurate.

---

### Task 6: Deploy and verify production

**Files:**
- Push: `~/code/grantradar/` (main branch to origin)

- [ ] **Step 1: Push to origin**

```bash
cd ~/code/grantradar && git push origin main
```

Expected: Vercel auto-deploys from main.

- [ ] **Step 2: Verify deployment succeeds**

Check Vercel dashboard or:

```bash
vercel ls --app grantradar 2>/dev/null || echo "Check https://vercel.com/dashboard"
```

Wait for deployment to complete (green checkmark).

- [ ] **Step 3: Verify cron schedules**

In Vercel dashboard → Project → Settings → Cron Jobs, confirm:
- `/api/sync-grants` — `0 13 * * *` (daily, CA)
- `/api/sync-federal` — `0 14 * * 0` (Sunday only)
- `/api/send-digests` — `50 14 * * 1` (Monday only)

- [ ] **Step 4: Trigger a manual federal sync to verify**

```bash
CRON_SECRET=$(grep CRON_SECRET ~/code/grantradar/.env.local | cut -d= -f2)
curl -s -H "Authorization: Bearer $CRON_SECRET" https://grantradar.vercel.app/api/sync-federal | python3 -m json.tool
```

Expected: Returns JSON with `fetched`, `upserted`, `new_or_changed` counts. No errors.

- [ ] **Step 5: Run /grants to verify end-to-end**

In Claude Code:

```
/grants
```

Expected: Shows pipeline with data from both CA portal and Grants.gov sources. AI classifications populated.

---

## Sprint Acceptance Criteria

- [ ] Federal sync cron is Sunday-only (`0 14 * * 0`)
- [ ] `grant_classify.py` classifies grants with ai_tags + ai_summary via Haiku
- [ ] `/grants` command shows pipeline dashboard from any directory
- [ ] All ~4,700 existing grants are classified (> 95% coverage)
- [ ] Matching engine uses ai_tags in scoring (already done — verify in digest)
- [ ] Production deployment is green with correct cron schedules
