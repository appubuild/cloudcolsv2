import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function mapShare(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    fileId: row.file_id ? String(row.file_id) : null,
    folderId: row.folder_id ? String(row.folder_id) : null,
    token: String(row.token),
    permission: row.permission as "view" | "download",
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    isRevoked: Boolean(row.is_revoked),
    createdAt: String(row.created_at),
    accessCount: Number(row.access_count ?? 0),
  };
}

// List active links for the owner.
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data, error } = await admin.from("share_links").select("*").eq("owner_id", user.id).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => mapShare(r as Record<string, unknown>));
});

// Create a share link.
interface Body {
  fileId?: string;
  folderId?: string;
  permission?: "view" | "download";
  expiresAt?: string | null;
}
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  const fileId = body.fileId ?? null;
  const folderId = body.folderId ?? null;
  if (Number(Boolean(fileId)) + Number(Boolean(folderId)) !== 1) {
    throw new ApiError("INVALID_INPUT", 400, "Share exactly one file or one folder.");
  }

  const admin = createAdminClient();

  /**
   * The caller must own what they are sharing.
   *
   * This route writes with the service-role client, which RLS does not constrain, and
   * it used to insert whatever id the request named. Anyone who learned another
   * account's file id — from a share page, an activity row, a URL — could mint a link
   * to it under their own name and download it through /api/shares/download, whose
   * only authority is the token. Checked here against the owner, and 404 rather than
   * 403 so the answer does not confirm that someone else's file exists.
   */
  const { data: owned } = await admin
    .from(fileId ? "files" : "folders")
    .select("id")
    .eq("id", (fileId ?? folderId)!)
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .maybeSingle();
  if (!owned) {
    throw new ApiError(fileId ? "FILE_NOT_FOUND" : "FOLDER_NOT_FOUND", 404, fileId ? "File not found." : "Folder not found.");
  }

  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const { data, error } = await admin
    .from("share_links")
    .insert({
      owner_id: user.id,
      file_id: fileId,
      folder_id: folderId,
      token,
      permission: body.permission ?? "view",
      expires_at: body.expiresAt ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapShare(data as Record<string, unknown>);
});
