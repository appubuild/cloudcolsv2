import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { checkPassword } from "@/lib/api/password";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

/**
 * Deleting your own account.
 *
 * Three things this used to get wrong:
 *
 *   - A session was enough. Whoever held one — a borrowed laptop, a stolen token —
 *     could erase the account and every file in it. It now needs the password again,
 *     rate-limited like login.
 *   - The file bytes were never deleted. The rows cascaded away with the auth user;
 *     the objects stayed in the bucket, billed and orphaned, after the user was told
 *     their files were removed. The account's folder is now queued for the
 *     storage-purge job (migration 0025) before anything is deleted.
 *   - Nothing recorded that it happened.
 */
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!body.password) {
    throw new ApiError("INVALID_INPUT", 400, "Enter your password to delete your account.");
  }

  // 403 rather than 401: the session is fine, the confirmation is not, and a 401 would
  // read to the client as "signed out".
  const confirmed = await checkPassword(user.email, body.password);
  if (!confirmed || confirmed.user.id !== user.id) {
    throw new ApiError("INVALID_CREDENTIALS", 403, "That password is not correct.");
  }

  const admin = createAdminClient();
  const prefix = `${user.id}/`;

  // Queued first. If this fails nothing has been deleted yet, and the user can retry;
  // the other order could lose track of the files for good. The purge job will not
  // touch the prefix while the account still exists, so queueing early is safe.
  const { error: queueError } = await admin
    .from("storage_purge_queue")
    .upsert({ prefix, reason: "account_deleted" }, { onConflict: "prefix" });
  if (queueError) throw queueError;

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    await admin.from("storage_purge_queue").delete().eq("prefix", prefix);
    throw new ApiError("DELETE_FAILED", 500, "Your account could not be deleted. Nothing was removed; please try again.");
  }

  await audit({
    actorId: user.id,
    actorType: "user",
    action: "user.delete_self",
    targetType: "user",
    targetId: user.id,
    metadata: { storagePrefixQueued: true },
  });

  return { deleted: true };
}, DEFAULT_LIMITS.accountDelete);
