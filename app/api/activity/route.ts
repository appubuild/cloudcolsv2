import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * What this account has been doing, newest first.
 *
 * Joined to the files and folders so a row can be shown without a second request
 * per item, and filtered to what still exists: an activity row survives its file
 * being trashed, and a Recent list full of things that are no longer there is
 * worse than a shorter one.
 */
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 20));
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("file_activity")
    .select(
      "id, action, occurred_at, file_id, folder_id, " +
        "files(original_filename, category, size_bytes, trashed_at, folder_id), " +
        "folders(name, icon, trashed_at)",
    )
    .eq("user_id", user.id)
    .order("occurred_at", { ascending: false })
    // Asked for more than needed, because some will be dropped below.
    .limit(limit * 2);
  if (error) throw error;

  // The generated types cannot see through an embedded select, so the row shape
  // is asserted once here rather than at every field.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  const items = rows
    .map((row) => {
      const file = row.files as {
        original_filename?: string;
        category?: string;
        size_bytes?: number;
        trashed_at?: string | null;
        folder_id?: string | null;
      } | null;
      const folder = row.folders as { name?: string; icon?: string | null; trashed_at?: string | null } | null;

      // The target is gone or in the trash.
      if (row.file_id && (!file || file.trashed_at)) return null;
      if (row.folder_id && (!folder || folder.trashed_at)) return null;

      return {
        id: String(row.id),
        action: String(row.action),
        occurredAt: String(row.occurred_at),
        kind: row.file_id ? ("file" as const) : ("folder" as const),
        targetId: String(row.file_id ?? row.folder_id),
        name: file?.original_filename ?? folder?.name ?? "Untitled",
        category: file?.category ?? null,
        sizeBytes: file?.size_bytes ?? null,
        icon: folder?.icon ?? null,
        folderId: file?.folder_id ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .slice(0, limit);

  return { items, total: items.length };
});
