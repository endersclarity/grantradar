# Supabase Remediation Commit Plan

**Scope:** draft a clean two-commit sequence to stage the Supabase client boundary split and the lockdown migration.
**Status:** plan only. Do not stage, do not commit, do not push while reading this file.
**Related:** `docs/supabase-remediation-checklist.md`, `docs/supabase-client-boundaries.md`, `supabase/migrations/010_lockdown_anon_access.sql`.

---

## Principles

1. **Two commits, not one.** The boundary split is a code refactor with no runtime SQL; the migration is a SQL-only change gated behind the boundary. Splitting them means 010 can be reverted without losing the boundary split, and the boundary split can be reviewed (or reverted) without reasoning about RLS.
2. **Branch off `main`, not from current dirty state.** The current working tree contains only the files listed in `git status --short` above these migrations; there is no unrelated work to separate.
3. **Do not include `.env.local` or any Supabase keys.** Secret scan in checklist §4 is a hard gate.
4. **Do not include `supabase/migrations/009_triage_column.sql`** in either commit unless it has been verified as not-yet-committed and matches the upstream version already applied. DEVLOG records 009 as applied; local working tree shows it untracked. Resolve separately before staging 010.
5. **Do not use `--no-verify`, `--amend`, or `git push --force`.** Conventional Commits format only.

---

## Branching

```
git checkout main
git pull --ff-only origin main
git checkout -b chore/supabase-lockdown
```

Do not branch off a dirty tree. If the working tree has uncommitted changes other than the files listed in this plan, stop and investigate — the prompt constraints say no destructive actions without confirmation.

---

## Commit 1 — Supabase client boundary split

### Proposed message

```
refactor(supabase): split client into server/browser boundary

Replace single src/lib/supabase.ts (service_role + NEXT_PUBLIC_ coupled in
one module) with two clients:

- src/lib/supabase-server.ts: service_role, begins with `import "server-only"`.
- src/lib/supabase-browser.ts: anon key, safe in client components.

All 16 call sites updated to import from supabase-server (every current
caller is server-side). No "use client" file imports Supabase. tsc --noEmit
passes. Lint delta is zero.

Documents the new boundary in docs/supabase-client-boundaries.md and adds
a read-only boundary-check script under scripts/. Prep work for migration
010; no SQL changes in this commit.
```

### Files

```
docs/supabase-client-boundaries.md                 # new
docs/supabase-remediation-checklist.md             # new
docs/supabase-remediation-commit-plan.md           # new (this file)
scripts/check_supabase_boundaries.sh               # new
src/lib/supabase-server.ts                         # new
src/lib/supabase-browser.ts                        # new
src/lib/supabase.ts                                # deleted
src/lib/grants.ts                                  # import update
src/lib/matching.ts                                # import update
src/app/api/checkout/route.ts                      # import update
src/app/api/send-digests/route.ts                  # import update
src/app/api/settings/route.ts                      # import update
src/app/api/signup/route.ts                        # import update
src/app/api/sync-federal/route.ts                  # import update
src/app/api/sync-grants/route.ts                   # import update
src/app/api/unsubscribe/route.ts                   # import update
src/app/api/verify-email/route.ts                  # import update
src/app/api/webhooks/stripe/route.ts               # import update
src/app/grants/[id]/page.tsx                       # import update
src/app/grants/page.tsx                            # import update
src/app/page.tsx                                   # import update
src/app/settings/page.tsx                          # import update
src/app/unsubscribe/page.tsx                       # import update
package.json                                       # dep bump if @supabase/supabase-js touched
pnpm-lock.yaml                                     # lockfile sync
```

Confirm every modified file is in the `M` / `??` / `D` list from `git status --short` before staging. Do not stage files not in the list above.

### Validation before staging commit 1

Run from repo root; all must pass:

```
pnpm exec tsc --noEmit                              # exit 0
pnpm lint                                           # no delta vs main
bash scripts/check_supabase_boundaries.sh           # exit 0
rg -n 'SUPABASE_SERVICE_ROLE_KEY' src               # only src/lib/supabase-server.ts
rg -n 'NEXT_PUBLIC_SUPABASE_ANON_KEY' src           # only src/lib/supabase-browser.ts
rg -n '@/lib/supabase"|./supabase"' src             # empty (no legacy imports)
rg -n '"use client"' -l src | xargs -I {} rg -l 'supabase-server' {} 2>/dev/null
                                                     # empty (no client importing server)
```

### Secret-scan before commit 1

```
rg -n 'eyJ[A-Za-z0-9_-]{20,}' .                    # no JWT literals (respects .gitignore)
rg -n 'sk_live_|sk_test_|whsec_' .                 # no Stripe keys
git diff --cached -- .env.local                     # empty output
git diff --cached --stat                            # no *.env*, no keys.json, no credentials.*
```

### Staging commands (do not execute while reading)

```
git add src/lib/supabase-server.ts src/lib/supabase-browser.ts
git add src/lib/supabase.ts        # captures the deletion
git add src/lib/grants.ts src/lib/matching.ts
git add src/app/api/checkout/route.ts src/app/api/send-digests/route.ts \
        src/app/api/settings/route.ts src/app/api/signup/route.ts \
        src/app/api/sync-federal/route.ts src/app/api/sync-grants/route.ts \
        src/app/api/unsubscribe/route.ts src/app/api/verify-email/route.ts \
        src/app/api/webhooks/stripe/route.ts
git add src/app/grants/[id]/page.tsx src/app/grants/page.tsx \
        src/app/page.tsx src/app/settings/page.tsx \
        src/app/unsubscribe/page.tsx
git add package.json pnpm-lock.yaml
git add docs/supabase-client-boundaries.md \
        docs/supabase-remediation-checklist.md \
        docs/supabase-remediation-commit-plan.md
git add scripts/check_supabase_boundaries.sh

git status --short                                   # confirm nothing stray
git diff --cached --stat                             # review size

git commit   # use -m with the proposed message above, or a HEREDOC
```

Do not chain `&&` these commands into one shot; read each diff before moving to the next.

---

## Commit 2 — Supabase lockdown migration

Runs only after commit 1 lands on the branch and all validation passes.

### Proposed message

```
feat(supabase): add migration 010 anon/authenticated lockdown

Enables RLS on public.sync_runs and public.webhook_events (previously off,
flagged by advisor as rls_disabled_in_public). Adds deny-all policies on
both tables mirroring migration 006 pattern on public.digests.

Revokes default anon/authenticated INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
TRIGGER grants on all 6 public tables; preserves SELECT for anon and
authenticated on public.grants and public.funders per existing
anon_read_grants / anon_read_funders policies.

service_role is unchanged; all Next.js server routes use service_role.
Migration 010 depends on the client boundary from the previous commit
staying true. Do not apply without reviewing docs/supabase-remediation-
checklist.md sections 10-13.
```

### Files

```
supabase/migrations/010_lockdown_anon_access.sql
```

Single-file commit. Nothing else belongs here.

### Validation before staging commit 2

```
head -5 supabase/migrations/010_lockdown_anon_access.sql
                                                # confirms header comment intact
rg -n 'BEGIN;|COMMIT;' supabase/migrations/010_lockdown_anon_access.sql
                                                # one of each; full transaction
rg -n 'DROP TABLE|DELETE FROM|TRUNCATE' supabase/migrations/010_lockdown_anon_access.sql
                                                # empty; migration is additive
bash scripts/check_supabase_boundaries.sh       # still passes after commit 1
```

### Staging commands

```
git add supabase/migrations/010_lockdown_anon_access.sql
git status --short
git diff --cached -- supabase/migrations/010_lockdown_anon_access.sql | head -80
git commit   # use the proposed message above
```

---

## What Not to Include

Explicit exclusion list — if any of these show up in `git status`, remove them before committing:

- `.env.local`, `.env`, `.env.*` — secrets; git-ignored, but double-check.
- `node_modules/` — ignored.
- `.next/`, `tsconfig.tsbuildinfo` — build artifacts; ignored.
- `supabase/migrations/009_triage_column.sql` — unless verified matches upstream applied state; file DEVLOG separately.
- Any new file under `src/` that wasn't touched by the refactor.
- Any `.sql` file outside `supabase/migrations/`.
- Any ad-hoc script under `/tmp` or `~/Desktop` that got pasted into the repo by accident.
- Any `.gstack/`, `.worktrees/`, `.vercel/` — repo-local metadata.
- Any log / screenshot / scratchpad file.

`git diff --cached --stat` before each commit. If the file list does not match the plan above, `git reset HEAD <unexpected-file>` and investigate.

---

## Push + PR

```
git push -u origin chore/supabase-lockdown
gh pr create --title "Supabase client boundary split + migration 010" \
             --body "$(cat <<'EOF'
## Summary
- Split Supabase client into server (service_role) + browser (anon) boundary.
- Add read-only boundary-check script.
- Add migration 010 to enable RLS on sync_runs and webhook_events and revoke broad anon/authenticated DML grants.

## Test plan
- [ ] tsc --noEmit
- [ ] pnpm lint (no delta vs main)
- [ ] bash scripts/check_supabase_boundaries.sh
- [ ] Visit Vercel preview: /grants renders, /settings works, bundle contains no service_role key.
- [ ] Migration 010 NOT applied in this PR; apply checklist runs in a separate session per docs/supabase-remediation-checklist.md.

## Safety
- No Supabase writes triggered by the PR.
- Migration 010 is staged for review, not executed.
- No secrets committed; secret scan in checklist §4 is green.
EOF
)"
```

Do not run `gh pr merge` from this session. Require explicit user approval on the PR before merge.

---

## Final Review Warnings

- **Do not `--amend`.** If a hook fails or something looks off after commit 1, fix the issue and add a **new** commit. Amending modifies the previous commit and can silently reshuffle history.
- **Do not `git push --force`.** Even on a feature branch, force-push overwrites collaborators' work if anyone has started a review.
- **Do not apply migration 010 as part of this PR.** The migration is staged as a file; `apply_migration` is a separate, gated action requiring explicit user approval and the checklist §10 gate.
- **Do not commit `.env.local`.** If `git diff --cached` shows any env file, `git reset HEAD .env.local` and run the secret scan again.
- **Do not include the boundary-check script in `package.json` scripts yet.** Wire it into CI only after the PR has been reviewed and the script has run clean twice locally.
- **Do not run `pnpm build` and commit `.next/`.** Build artifacts are git-ignored; never force-add them.
