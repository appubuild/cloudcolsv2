import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/services/b2";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

type Params = { fileId: string };

/**
 * A short-lived URL so an admin can look at a user's file.
 *
 * This is the one endpoint in the application that hands someone the contents of
 * a file they do not own, which is why it is separate from the user download
 * route rather than a flag on it — a flag is something that gets passed by
 * accident, and this must never be reachable by an ordinary session.
 *
 * Every use is written to the audit log with the file and the admin, before the
 * URL is issued. Looking at a customer's private files is a thing that should
 * leave a trace whether or not anything came of it, and recording it first means
 * a failure after this point still leaves the record.
 *
 * Five minutes, and inline: this is for looking, and a shorter life means a URL
 * pasted somewhere stops working quickly.
 */
export const GET = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const admin = await requireAdmin(req, "support");
  const { fileId } = (await ctx?.params) ?? { fileId: "" };

  const client = createAdminClient();
  const { data: file } = await client
    .from("files")
    .select("id, owner_id, object_key, original_filename, mime_type, category, size_bytes, status")
    .eq("id", fileId)
    .maybeSingle();

  if (!file) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  if (file.status !== "ready") throw new ApiError("FILE_NOT_READY", 409, "That file is not available.");

  await audit({
    actorId: admin.id,
    actorType: "admin",
    action: "admin.file_previewed",
    targetType: "file",
    targetId: String(file.id),
    metadata: {
      ownerId: String(file.owner_id),
      filename: String(file.original_filename),
      adminEmail: admin.email,
      role: admin.role,
    },
  });

  const { presignedUrl, expiresIn } = await getPresignedDownloadUrl(String(file.object_key), 300, {
    ...(file.mime_type ? { contentType: String(file.mime_type) } : {}),
  });

  return {
    url: presignedUrl,
    expiresIn,
    filename: String(file.original_filename),
    category: String(file.category),
    mimeType: file.mime_type ? String(file.mime_type) : null,
    sizeBytes: Number(file.size_bytes ?? 0),
  };
});
