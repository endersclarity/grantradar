-- 010: Lock down anon / authenticated access across public schema
--
-- DO NOT EXECUTE WITHOUT REVIEW. Drafted 2026-04-24 per docs/supabase-security-audit.md.
--
-- What this migration does:
--   1. Enables RLS on public.sync_runs and public.webhook_events (currently off).
--      These are the two advisor-flagged tables (lint 0013_rls_disabled_in_public).
--   2. Adds deny-all RLS policies on those two tables — mirrors the pattern used
--      for public.digests in migration 006.
--   3. Revokes the permissive default INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
--      grants that Supabase applies to `anon` and `authenticated` on every
--      public table. RLS alone is not sufficient defense-in-depth — both the
--      role grant AND an allow-policy are required for a successful mutation,
--      so removing the role grant is a belt-and-suspenders lockdown.
--   4. Preserves SELECT for `anon` and `authenticated` on public.grants and
--      public.funders — the app already treats those as public-readable, and
--      the existing policies `anon_read_grants` / `anon_read_funders` depend
--      on the SELECT role grant remaining in place.
--   5. Does not alter `service_role`. service_role bypasses RLS and retains
--      default superuser-like privileges in Supabase; all write paths in the
--      Next.js app go through service_role server-side.
--   6. Does not drop tables or delete data.

BEGIN;

-- -----------------------------------------------------------------------------
-- Block 1: Enable RLS on sync_runs + webhook_events
-- -----------------------------------------------------------------------------

ALTER TABLE public.sync_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Block 2: Deny-all policies on sync_runs + webhook_events
--
-- Pattern matches public.digests from migration 006. Each policy evaluates
-- to false, so no anon/authenticated operation can match. service_role
-- bypasses RLS entirely and is unaffected.
-- -----------------------------------------------------------------------------

CREATE POLICY "anon_no_read_sync_runs"   ON public.sync_runs FOR SELECT USING (false);
CREATE POLICY "anon_no_insert_sync_runs" ON public.sync_runs FOR INSERT WITH CHECK (false);
CREATE POLICY "anon_no_update_sync_runs" ON public.sync_runs FOR UPDATE USING (false);
CREATE POLICY "anon_no_delete_sync_runs" ON public.sync_runs FOR DELETE USING (false);

CREATE POLICY "anon_no_read_webhook_events"   ON public.webhook_events FOR SELECT USING (false);
CREATE POLICY "anon_no_insert_webhook_events" ON public.webhook_events FOR INSERT WITH CHECK (false);
CREATE POLICY "anon_no_update_webhook_events" ON public.webhook_events FOR UPDATE USING (false);
CREATE POLICY "anon_no_delete_webhook_events" ON public.webhook_events FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- Block 3: Revoke permissive defaults on every public table
--
-- Supabase's default role grants give anon and authenticated full DML
-- (DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE) on every
-- public table. We strip every privilege that is never intended for those
-- roles. SELECT is revoked here and then re-granted in Block 4 only where
-- public readability is intentional.
-- -----------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.grants         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.funders        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT
  ON public.organizations  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT
  ON public.digests        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT
  ON public.sync_runs      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT
  ON public.webhook_events FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Block 4: Preserve intended SELECT for public-readable tables
--
-- The `anon_read_grants` and `anon_read_funders` policies (migration 006 +
-- 007) evaluate to true, so these two tables are intentionally readable by
-- the anon key. Block 3 revoked SELECT above as a no-op (we already had it)
-- — this is the matching explicit re-grant so the intent is visible in the
-- migration and diffable in review. If you want to stop exposing grants /
-- funders publicly in the future, drop both lines here AND the corresponding
-- SELECT policies.
-- -----------------------------------------------------------------------------

-- (Block 3 left grants + funders SELECT intact — no REVOKE SELECT on those.)
-- Explicit GRANT to make intent clear and to self-heal if a prior environment
-- was hand-edited:
GRANT SELECT ON public.grants  TO anon, authenticated;
GRANT SELECT ON public.funders TO anon, authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK (do not include in the migration; keep here for operator reference)
-- =============================================================================
--
-- BEGIN;
--
-- -- Undo Block 4 (no-op if you never needed the explicit grant)
-- -- (leave SELECT in place; reverting to pre-migration state means restoring
-- --  the broad default grants below)
--
-- -- Undo Block 3: restore Supabase defaults
-- GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   ON public.grants, public.funders, public.organizations, public.digests,
--      public.sync_runs, public.webhook_events
--   TO anon, authenticated;
--
-- -- Undo Block 2: drop the deny-all policies
-- DROP POLICY IF EXISTS "anon_no_read_sync_runs"       ON public.sync_runs;
-- DROP POLICY IF EXISTS "anon_no_insert_sync_runs"     ON public.sync_runs;
-- DROP POLICY IF EXISTS "anon_no_update_sync_runs"     ON public.sync_runs;
-- DROP POLICY IF EXISTS "anon_no_delete_sync_runs"     ON public.sync_runs;
-- DROP POLICY IF EXISTS "anon_no_read_webhook_events"   ON public.webhook_events;
-- DROP POLICY IF EXISTS "anon_no_insert_webhook_events" ON public.webhook_events;
-- DROP POLICY IF EXISTS "anon_no_update_webhook_events" ON public.webhook_events;
-- DROP POLICY IF EXISTS "anon_no_delete_webhook_events" ON public.webhook_events;
--
-- -- Undo Block 1: disable RLS on the two tables
-- ALTER TABLE public.sync_runs      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.webhook_events DISABLE ROW LEVEL SECURITY;
--
-- COMMIT;

-- =============================================================================
-- VERIFICATION QUERIES (run post-apply; each should match expectations below)
-- =============================================================================

-- V1. Confirm RLS is on for every public table.
-- Expect: rowsecurity = true for all 6 tables.
--
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;

-- V2. Confirm Supabase security advisor has 0 errors.
-- Expect: empty list (no rls_disabled_in_public).
--
-- Run via MCP: get_advisors(project_id, type="security")

-- V3. Confirm deny-all policies exist on sync_runs + webhook_events.
-- Expect: 4 policies per table (SELECT/INSERT/UPDATE/DELETE), all with
-- qual = 'false' or with_check = 'false'.
--
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('sync_runs', 'webhook_events')
-- ORDER BY tablename, policyname;

-- V4. Confirm role grants are locked down.
-- Expect:
--   anon + authenticated have ONLY 'SELECT' on public.grants, public.funders.
--   anon + authenticated have NO privileges on organizations, digests,
--     sync_runs, webhook_events.
--
-- SELECT grantee, table_name,
--        string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
-- FROM information_schema.role_table_grants
-- WHERE grantee IN ('anon','authenticated')
--   AND table_schema = 'public'
-- GROUP BY grantee, table_name
-- ORDER BY table_name, grantee;

-- V5. Smoke-test the Next.js app post-apply:
--   - Trigger /api/sync-grants  (should succeed; uses service_role).
--   - Trigger /api/webhooks/stripe with a test event (should succeed; service_role).
--   - Trigger /api/send-digests (should succeed; service_role).
--   - Hit /grants page while signed out (should still render grants list;
--     anon SELECT on public.grants still allowed).
--   - Hit /settings page (should work; routes through /api/settings with
--     service_role — no direct anon access to organizations).

-- =============================================================================
-- RISKS & ASSUMPTIONS
-- =============================================================================
--
-- A1. Assumes the Next.js app uses service_role for ALL database access.
--     Verified 2026-04-24: no "use client" file imports lib/supabase.ts; the
--     only createClient call uses SUPABASE_SERVICE_ROLE_KEY. If a future
--     change adds a browser-side Supabase client, anon access to
--     organizations, digests, sync_runs, webhook_events will be fully
--     blocked and those features will break silently (RLS denial surfaces
--     as empty result sets, not errors).
--
-- A2. Assumes public.grants and public.funders are intentionally world-
--     readable via the anon key. The existing migration 006 and 007
--     create USING (true) SELECT policies. If product direction changes
--     to gate grants behind login, revoke SELECT here AND drop the
--     corresponding policies — RLS alone with an allow-all SELECT policy
--     plus a revoked role grant results in NO access (policies are
--     evaluated on top of role grants).
--
-- R1. Race risk: if the app is live and a request fires mid-migration,
--     the REVOKE on sync_runs or webhook_events could surface as a
--     permission error. Run during low-traffic window. The migration is
--     wrapped in a single transaction, so a failure rolls back cleanly.
--
-- R2. Supabase managed roles: Supabase may periodically re-apply default
--     grants (historically via `supabase_admin` maintenance). If that
--     happens, re-run this migration or set up a scheduled check via
--     V4 query. Not currently observed but worth monitoring.
--
-- R3. authenticated role: this project does not use Supabase Auth today
--     (no auth.users sign-ups). Locking down `authenticated` the same
--     way as `anon` is the conservative default. If Supabase Auth is
--     introduced later, revisit and add scoped policies per feature.
--
-- R4. The migration does NOT address the broader audit findings around:
--       - the orphaned SUPABASE_URL in /Users/ender/code/NorthstarHouse/.env
--       - the 5 unrelated paused projects in the org
--       - the anon JWT embedded in 7 HTML files under vault-2/dev/
--       - the single-file supabase client coupling service_role + NEXT_PUBLIC_
--     Those are tracked separately in docs/supabase-security-audit.md.
