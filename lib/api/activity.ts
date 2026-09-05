import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export type ActivityAction = "opened" | "previewed" | "downloaded" | "uploaded" | "modified" | "shared";

/**
 * Records what someone did with a file or folder.
 *
 * files.last_accessed_at already says that something happened; it cannot say
 * what, and it cannot show one file twice for two different reasons — a file
 * opened this morning and downloaded this afternoon is one row and one story.
 *
 * Deliberately fire-and-forget. Recording that a file was opened is worth having
 * and is not worth failing the open over, so a failure here is swallowed: the user
 * gets their file either way.
 *
 * The upsert lives in the database (record_activity), so repeating an action moves
 * its timestamp instead of adding a row. Without that, opening the same file twice
 * in a minute would fill the list with itself.
 */
export async function recordActivity(
  userId: string,
  target: { fileId?: string | null; folderId?: string | null },
  action: ActivityAction,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.rpc("record_activity", {
      p_user_id: userId,
      p_file_id: target.fileId ?? null,
      p_folder_id: target.folderId ?? null,
      p_action: action,
    });
  } catch {
    // Never block the thing the user actually asked for.
  }
}
