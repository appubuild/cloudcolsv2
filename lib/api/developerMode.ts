// Developer mode: an account's opt-in to the Developer API.
//
// Checked on the server wherever developer capabilities are created — API keys and
// webhooks — so the gate is not only a card the portal shows. A switch that only the
// page respects is a switch any request can walk around.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { ApiError } from "./auth";

export async function isDeveloperModeOn(userId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("user_storage")
    .select("developer_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data?.developer_enabled);
}

export async function requireDeveloperMode(userId: string): Promise<void> {
  if (!(await isDeveloperModeOn(userId))) {
    throw new ApiError(
      "DEVELOPER_MODE_OFF",
      403,
      "Turn on developer mode first, from the Developer portal.",
    );
  }
}
