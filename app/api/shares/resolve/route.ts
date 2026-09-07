import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { resolveShare, countShareAccess } from "@/lib/api/shares";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFile, mapFolder } from "@/lib/api/mappers";

export const dynamic = "force-dynamic";

/**
 * Resolve a public share token. No auth — it is a public link — but the link has to
 * be valid, unrevoked, unexpired, and to point at something still servable.
 *
 * The rules live in lib/api/shares so this and the server-rendered page cannot drift.
 * They did drift once already: a page that rendered a file the API would refuse, and
 * a trashed file that stayed reachable through a link its owner thought was dead.
 */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) throw new ApiError("INVALID_INPUT", 400, "token is required.");

  const state = await resolveShare(token);
  if (state.kind === "revoked") throw new ApiError("SHARE_REVOKED", 410, "This link is no longer available.");
  if (state.kind === "expired") throw new ApiError("SHARE_EXPIRED", 410, "This link has expired.");
  if (state.kind === "not_found") throw new ApiError("SHARE_NOT_FOUND", 404, "This link is no longer available.");

  await countShareAccess(state.share.id, state.share.accessCount);

  // The full rows, in the shape the client already consumes. The resolver returns
  // only what a share page needs; this endpoint predates it and its callers expect
  // mapFile/mapFolder output.
  const admin = createAdminClient();
  let file = null;
  let folder = null;
  if (state.file) {
    const { data } = await admin.from("files").select("*").eq("id", state.file.id).maybeSingle();
    file = data ? mapFile(data as Record<string, unknown>) : null;
  }
  if (state.folder) {
    const { data } = await admin.from("folders").select("*").eq("id", state.folder.id).maybeSingle();
    folder = data ? mapFolder(data as Record<string, unknown>) : null;
  }

  return {
    share: {
      id: state.share.id,
      ownerId: state.share.ownerId,
      fileId: state.share.fileId,
      folderId: state.share.folderId,
      token: state.share.token,
      permission: state.share.permission,
      expiresAt: state.share.expiresAt,
      isRevoked: false,
      createdAt: state.share.createdAt,
      accessCount: state.share.accessCount + 1,
    },
    file,
    folder,
  };
});
