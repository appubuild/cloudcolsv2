// Supabase SERVER-SIDE client using the service-role key.
// This is the ONLY module that accesses the service-role key. It must never be
// imported from a client component or bundled into the browser.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/config/server-env";

export function createAdminClient() {
  const url = serverEnv.supabaseUrl;
  const key = serverEnv.supabaseServiceRoleKey;
  if (!url || !key) {
    // Name what is missing. "not configured" over a dashboard of ten variables is
    // not something anyone can act on.
    const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
    throw new Error(`${missing.join(" and ")} not set on the server.`);
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
