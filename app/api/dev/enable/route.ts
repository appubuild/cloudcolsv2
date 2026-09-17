import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";
import { isDeveloperModeOn } from "@/lib/api/developerMode";

export const dynamic = "force-dynamic";

/**
 * Turns on developer mode for the signed-in account.
 *
 * The portal's button used to call the profile update with developerEnabled: true —
 * a field that update never sent to the server — so it did nothing at all, beside a
 * note calling itself a demo. Nothing anywhere could set developer_enabled.
 *
 * Free to turn on: it grants no quota and costs nothing. Keys start on the free API
 * plan (lib/api/apiPlan), whose limits are what protect the service. Idempotent, so a
 * double click or a second tab is harmless.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);

  if (!(await isDeveloperModeOn(user.id))) {
    const { error } = await createAdminClient()
      .from("user_storage")
      .update({ developer_enabled: true })
      .eq("user_id", user.id);
    if (error) throw error;

    await audit({
      actorId: user.id,
      actorType: "user",
      action: "developer_mode.enabled",
      targetType: "user",
      targetId: user.id,
    });
  }

  return { developerEnabled: true };
});
