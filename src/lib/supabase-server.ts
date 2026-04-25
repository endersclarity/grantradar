// Server-only Supabase client.
//
// WARNING: This module uses the SUPABASE_SERVICE_ROLE_KEY, which bypasses
// Row Level Security. Importing it from a client component or any code that
// runs in the browser will ship the service-role key to end users and grant
// arbitrary read/write to every table in the project.
//
// The `import "server-only"` directive below causes Next.js to throw a build
// error if this file is ever imported into a client bundle. Do not remove.
//
// If you need Supabase access from a "use client" file, import from
// `@/lib/supabase-browser` instead — that client uses the anon key and is
// gated by the RLS policies defined in supabase/migrations/.

import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    _supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}

export const supabaseServer = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseServer() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
