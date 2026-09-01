// Supabase SERVER-SIDE client using the service-role key.
// This is the ONLY module that accesses the service-role key. It must never be
// imported from a client component or bundled into the browser.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/config/env";

export function createAdminClient() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured.");
  }
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
