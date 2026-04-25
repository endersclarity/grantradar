// Browser-safe Supabase client.
//
// Uses the anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) and is gated by the RLS
// policies in supabase/migrations/. Safe to import from "use client" files
// and server components alike.
//
// Capabilities under current RLS (as of migration 010):
//   - SELECT on public.grants  (anon_read_grants  USING true)
//   - SELECT on public.funders (anon_read_funders USING true)
//   - No access to organizations, digests, sync_runs, webhook_events.
//
// If you need write access or access to locked-down tables, route through an
// API handler that uses `@/lib/supabase-server`.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
    if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
    _supabase = createClient(url, key);
  }
  return _supabase;
}

export const supabaseBrowser = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseBrowser() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
