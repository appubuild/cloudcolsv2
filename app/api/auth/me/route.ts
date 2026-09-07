import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { ensureProfile } from "@/lib/api/profiles";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const profile = await ensureProfile(user.id);
  return {
    id: user.id,
    email: user.email,
    // Returned so the client stops inventing a name from the address. Without these
    // two, PATCH /api/profile wrote a display name that nothing could ever read
    // back, and the greeting and Settings both showed the email's local part.
    displayName: profile.display_name ?? null,
    avatarUrl: profile.avatar_url ?? null,
    planId: profile.plan_id,
    storageQuotaBytes: profile.storage_quota_bytes,
    storageUsedBytes: profile.storage_used_bytes,
    developerEnabled: profile.developer_enabled,
    status: profile.status,
  };
});
