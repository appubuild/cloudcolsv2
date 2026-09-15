// Trash cleanup job.
// Deletes objects that have been in the trash beyond the retention window
// (configurable; default 30 days). Runs asynchronously; never in a request.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { deleteObject } from "@/lib/services/b2";
import { audit } from "@/lib/api/audit";
import { getSetting } from "@/lib/settings/system";

/**
 * How long a trashed file survives.
 *
 * From system_settings, so an admin can change it. It used to read
 * TRASH_RETENTION_DAYS from process.env — which on Workers does not see the
 * binding, so this always returned the 30-day default no matter what was set.
 */
export async function trashRetentionDays(): Promise<number> {
  return getSetting("trash_retention_days");
}

export async function runTrashCleanup(): Promise<string> {
  const admin = createAdminClient();
  const retentionDays = await trashRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  const { data, error } = await admin
    .from("files")
    .select("id, object_key, owner_id, thumbnail_url")
    .not("trashed_at", "is", null)
    .lt("trashed_at", cutoff);

  let deleted = 0;
  if (error) return `Trash cleanup failed: ${error.message}`;

  for (const file of (data ?? [])) {
    await deleteObject(String(file.object_key));
    // The thumbnail is a second object (thumbnail_url holds its key). Deleting only the
    // file left every thumbnail in the bucket after its file was gone for good.
    const thumb = file.thumbnail_url ? String(file.thumbnail_url) : "";
    if (thumb && thumb.startsWith(`${String(file.owner_id)}/`)) await deleteObject(thumb);
    await admin.from("files").delete().eq("id", String(file.id));
    deleted += 1;
  }
  // Folders too.
  const { data: folders } = await admin
    .from("folders")
    .select("id")
    .not("trashed_at", "is", null)
    .lt("trashed_at", cutoff);
  for (const f of (folders ?? [])) {
    await admin.from("folders").delete().eq("id", String(f.id));
  }

  await audit({ actorType: "system", action: "job.trash_cleanup", targetType: "job", targetId: "trash-cleanup", metadata: { deleted, retentionDays } });
  return `Trash cleanup removed ${deleted} file(s) older than ${retentionDays} days.`;
}
