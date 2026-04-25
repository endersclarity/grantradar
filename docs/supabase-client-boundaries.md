# Supabase Client Boundaries

**Status:** authoritative as of 2026-04-24
**Scope:** every file under `src/` that touches Supabase
**Related:** `supabase/migrations/010_lockdown_anon_access.sql`, `docs/supabase-security-audit.md` (vault)

---

## TL;DR

Two Supabase clients. One per boundary. No exceptions.

| File | Key | Runs where | RLS |
|---|---|---|---|
| `src/lib/supabase-server.ts` | `SUPABASE_SERVICE_ROLE_KEY` | Server only | **Bypassed** |
| `src/lib/supabase-browser.ts` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anywhere | **Enforced** |

Migration 010 locks down the anon role across every public table and relies on this boundary being true. If a client component ever imports `supabase-server`, the service-role key ships to end users and every RLS policy collapses.

---

## Rules

1. **`src/lib/supabase-server.ts` is the only file in the repo that instantiates a client with `SUPABASE_SERVICE_ROLE_KEY`.** It begins with `import "server-only"`. Next.js throws a build error if this module is pulled into a client bundle.
2. **`src/lib/supabase-browser.ts` is the only file that instantiates a client with the anon key.** Safe in `"use client"` files, server components, and API routes alike. All reads are subject to RLS.
3. **No `"use client"` file may import `@/lib/supabase-server`.** The `server-only` guard enforces this at build time; code review enforces it at review time.
4. **Sensitive tables** (`organizations`, `digests`, `sync_runs`, `webhook_events`) are reachable only via service_role — either directly in server code or through an API route that uses `supabaseServer`. Migration 010 revokes anon/authenticated grants on these tables and adds deny-all RLS policies; any browser-side access will silently return empty or fail with permission errors.
5. **Public-readable tables** (`grants`, `funders`) keep anon SELECT enabled by design. Migration 010 preserves that grant plus the existing `anon_read_grants` / `anon_read_funders` policies. Future browser features that just need to read grants/funders should use `supabaseBrowser` — no server round-trip required.
6. **Future browser Supabase work imports `supabaseBrowser` explicitly, not aliased as `supabase`.** The current server codebase aliases `supabaseServer as supabase` because every existing call site was server-side and the alias kept the migration diff small. Once client-side usage begins, clarity matters more than diff size — use the literal `supabaseBrowser` name at call sites.
7. **Supabase Auth is not enabled today.** No `auth.users` sign-ups, no sessions, no RLS policies referencing `auth.uid()`. If Supabase Auth is introduced:
   - Review every `authenticated`-role grant revoked in migration 010 before relying on `authenticated` as a permission.
   - Add scoped policies (`USING (auth.uid() = user_id)` or equivalent) per table before letting authenticated browsers write anything.
   - Re-run the security advisor.

---

## What the files look like (contract, not implementation)

### `src/lib/supabase-server.ts`

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
// ...uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
export const supabaseServer: SupabaseClient = /* singleton */;
```

- Header comment: *"This module uses the SUPABASE_SERVICE_ROLE_KEY, which bypasses Row Level Security. Importing it from a client component or any code that runs in the browser will ship the service-role key to end users and grant arbitrary read/write to every table in the project."*

### `src/lib/supabase-browser.ts`

```ts
import { createClient } from "@supabase/supabase-js";
// ...uses NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
export const supabaseBrowser: SupabaseClient = /* singleton */;
```

- Header comment: *"Safe to import from `use client` files and server components alike. All reads are subject to RLS."*

---

## Validation (captured 2026-04-24)

Run these from the repo root. All should match the documented state before 010 is staged.

| Check | Command | Expected | Current |
|---|---|---|---|
| Typecheck clean | `npx tsc --noEmit` | exit 0 | **exit 0** ✓ |
| `SERVICE_ROLE_KEY` usage in `src/` | `rg -n SERVICE_ROLE src` | appears only in `src/lib/supabase-server.ts` | **only `supabase-server.ts` (3 lines: comment + 2 in guard)** ✓ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` usage in `src/` | `rg -n NEXT_PUBLIC_SUPABASE_ANON_KEY src` | appears only in `src/lib/supabase-browser.ts` | **only `supabase-browser.ts` (3 lines: comment + 2 in guard)** ✓ |
| Legacy `@/lib/supabase` imports | `rg -n 'from "@/lib/supabase"\|from "./supabase"' src \| grep -v supabase-server \| grep -v supabase-browser` | empty | **empty** ✓ |
| Client components importing Supabase | `for f in $(find src -name '*.tsx' -o -name '*.ts'); do head -1 "$f" \| grep -q '"use client"' && rg -l '@/lib/supabase\|./supabase' "$f"; done` | empty | **empty** (10 real `"use client"` files scanned: `app/error.tsx`, `app/settings/error.tsx`, `app/settings/settings-form.tsx`, `app/unsubscribe/error.tsx`, `app/unsubscribe/unsubscribe-confirm.tsx`, `components/signup-form.tsx`, `components/ui/{button,label,select,separator}.tsx`) ✓ |
| Lint delta from Supabase split | `pnpm lint` before vs after | no new errors attributable to the split | **19 errors pre-existing on HEAD** (confirmed via `git stash` comparison); **0 of them involve supabase files or new imports** ✓ |

---

## How to extend

- **New server-side Supabase caller?** `import { supabaseServer as supabase } from "@/lib/supabase-server";` — or, if you prefer the non-aliased name going forward, `import { supabaseServer } from "@/lib/supabase-server";`
- **New browser-side Supabase caller?** `import { supabaseBrowser } from "@/lib/supabase-browser";` and use `supabaseBrowser` at the call site. Do not alias.
- **New sensitive table?** Add deny-all anon policies + revoke anon/authenticated DML grants in a new migration before any code reads from it. Mirror the pattern in migration 010.
- **New public-readable table?** Add a `USING (true)` SELECT policy for anon and grant SELECT to anon/authenticated. Browser reads go through `supabaseBrowser`.

---

## Migration 010 dependency

`supabase/migrations/010_lockdown_anon_access.sql` is safe to stage **only while every statement in this document remains true**. In particular:

- Revoking anon INSERT/UPDATE/DELETE/TRUNCATE on all public tables is safe because no code path invokes the anon key to write.
- Enabling RLS + deny-all on `sync_runs` and `webhook_events` is safe because those tables are only touched by server code using service_role (which bypasses RLS).
- Keeping SELECT grants on `grants` and `funders` preserves the intentional public-read behavior — browser code can read them via `supabaseBrowser` after future client-side features are added.

If any of the rules above are violated (e.g., a client component starts using the server client, or a new table is added without policies), 010 becomes unsafe and must be re-evaluated.

---

## Change log

- **2026-04-24** — initial authoritative version. Codifies boundary established by the client split (removed `src/lib/supabase.ts`, added `supabase-server.ts` + `supabase-browser.ts`). No app code changes in this document.
