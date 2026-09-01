import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFile, mapFolder } from "@/lib/api/mappers";

export const dynamic = "force-dynamic";

// Resolve a public share token. No auth required (it's a public link), but the
// link must be valid, not revoked, and not expired.
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) throw new ApiError("INVALID_INPUT", 400, "token is required.");

  const admin = createAdminClient();
  const { data: share } = await admin.from("share_links").select("*").eq("token", token).maybeSingle();
  if (!share) throw new ApiError("SHARE_NOT_FOUND", 404, "This link is no longer available.");
  if (share.is_revoked) throw new ApiError("SHARE_REVOKED", 410, "This link is no longer available.");
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    throw new ApiError("SHARE_EXPIRED", 410, "This link has expired.");
  }

  let file = null;
  let folder = null;
  if (share.file_id) {
    const { data } = await admin.from("files").select("*").eq("id", share.file_id).maybeSingle();
    file = data ? mapFile(data as Record<string, unknown>) : null;
  }
  if (share.folder_id) {
    const { data } = await admin.from("folders").select("*").eq("id", share.folder_id).maybeSingle();
    folder = data ? mapFolder(data as Record<string, unknown>) : null;
  }
  if (!file && !folder) throw new ApiError("SHARE_NOT_FOUND", 404, "This link is no longer available.");

  await admin.from("share_links").update({ access_count: (share.access_count ?? 0) + 1 }).eq("id", share.id);

  return {
    share: {
      id: String(share.id),
      ownerId: String(share.owner_id),
      fileId: share.file_id ? String(share.file_id) : null,
      folderId: share.folder_id ? String(share.folder_id) : null,
      token: String(share.token),
      permission: share.permission as "view" | "download",
      expiresAt: share.expires_at ? String(share.expires_at) : null,
      isRevoked: Boolean(share.is_revoked),
      createdAt: String(share.created_at),
      accessCount: Number(share.access_count ?? 0) + 1,
    },
    file,
    folder,
  };
});
