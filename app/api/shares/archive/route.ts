import "server-only";
import { limited, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveDelivery } from "@/lib/services/delivery";
import { resolveShare, countShareAccess } from "@/lib/api/shares";
import { archiveEntries } from "@/lib/services/archive";

export const dynamic = "force-dynamic";

/**
 * The same listing as the owner's archive route, for someone holding a share link.
 *
 * Authority is the token and nothing else: it names one folder, and the walk starts
 * there, so there is no id in this request that could point anywhere else. The URLs
 * are share-class — cacheable at the edge and not bound to an account, because the
 * recipient has no account here.
 */
export const GET = limited(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) throw new ApiError("INVALID_INPUT", 400, "token is required.");

  const state = await resolveShare(token);
  // The same refusals, in the same words, as resolving and downloading a file share.
  if (state.kind === "revoked") throw new ApiError("SHARE_REVOKED", 410, "This link is no longer available.");
  if (state.kind === "expired") throw new ApiError("SHARE_EXPIRED", 410, "This link has expired.");
  if (state.kind !== "ready" || !state.folder) {
    throw new ApiError("SHARE_NOT_FOUND", 404, "This link is no longer available.");
  }

  const cursor = url.searchParams.get("cursor");
  const page = await archiveEntries({
    ownerId: state.share.ownerId,
    root: state.folder,
    cursor,
    limit: Number(url.searchParams.get("limit") ?? 0),
    countTotal: !cursor,
    deliver: (file) =>
      resolveDelivery({
        objectKey: file.objectKey,
        deliveryClass: "s",
        disposition: "attachment",
        filename: file.filename,
        ...(file.mimeType ? { contentType: file.mimeType } : {}),
        fallbackTtlSeconds: 3600,
      }),
  });

  // Counted once per download, on its first page, not once per page of listing.
  if (!cursor) await countShareAccess(state.share.id, state.share.accessCount);

  return { folderName: state.folder.name, ...page };
}, DEFAULT_LIMITS.downloadUrl);
