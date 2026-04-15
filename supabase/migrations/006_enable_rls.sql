-- 006: Enable Row Level Security on all tables
-- Current app uses service_role key (bypasses RLS), but anon key is
-- NEXT_PUBLIC_ (exposed in client JS). Without RLS, anyone with the
-- anon key can read/write all tables via Supabase REST API.

-- === ORGANIZATIONS ===
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Anon can read their own org via unsubscribe_token (settings/unsubscribe pages)
-- Not needed now (server-side only), but safe default
CREATE POLICY "anon_read_own_org" ON organizations
  FOR SELECT USING (false);

-- No anon writes
CREATE POLICY "anon_no_insert_org" ON organizations
  FOR INSERT WITH CHECK (false);

CREATE POLICY "anon_no_update_org" ON organizations
  FOR UPDATE USING (false);

CREATE POLICY "anon_no_delete_org" ON organizations
  FOR DELETE USING (false);

-- === GRANTS ===
ALTER TABLE grants ENABLE ROW LEVEL SECURITY;

-- Grants are public — anon can read
CREATE POLICY "anon_read_grants" ON grants
  FOR SELECT USING (true);

-- No anon writes to grants
CREATE POLICY "anon_no_insert_grants" ON grants
  FOR INSERT WITH CHECK (false);

CREATE POLICY "anon_no_update_grants" ON grants
  FOR UPDATE USING (false);

CREATE POLICY "anon_no_delete_grants" ON grants
  FOR DELETE USING (false);

-- === DIGESTS ===
ALTER TABLE digests ENABLE ROW LEVEL SECURITY;

-- Digests are internal — no anon access
CREATE POLICY "anon_no_read_digests" ON digests
  FOR SELECT USING (false);

CREATE POLICY "anon_no_insert_digests" ON digests
  FOR INSERT WITH CHECK (false);

CREATE POLICY "anon_no_update_digests" ON digests
  FOR UPDATE USING (false);

CREATE POLICY "anon_no_delete_digests" ON digests
  FOR DELETE USING (false);
