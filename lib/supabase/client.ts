"use client";

// Supabase BROWSER client using the public anon key.
// Used only if we route auth through Supabase directly from the client. In the
// Phase 2 layout we prefer server-side sessions; this remains available.

import { createClient } from "@supabase/supabase-js";
import { publicConfig } from "@/lib/config/public-config";

let client: ReturnType<typeof createClient> | null = null;

export function getBrowserClient() {
  const { supabaseUrl, supabaseAnonKey } = publicConfig();
  if (!supabaseUrl || !supabaseAnonKey) return null;
  if (!client) client = createClient(supabaseUrl, supabaseAnonKey);
  return client;
}
