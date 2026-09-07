// Resolving a share token, in one place.
//
// Two callers need this and must never disagree: the route handler the browser
// calls, and the server component that renders the page. A page that renders and
// then fails at the API, or renders a preview for something the API refuses, is
// exactly the kind of split a second copy produces.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export type ShareState =
  | { kind: "not_found" }
  | { kind: "revoked" }
  | { kind: "expired" }
  | {
      kind: "ready";
      share: {
        id: string;
        ownerId: string;
        fileId: string | null;
        folderId: string | null;
        token: string;
        permission: "view" | "download";
        expiresAt: string | null;
        createdAt: string;
        accessCount: number;
      };
      file: {
        id: string;
        originalFilename: string;
        category: string;
        sizeBytes: number;
        mimeType: string | null;
        createdAt: string;
        hasThumbnail: boolean;
        objectKey: string;
      } | null;
      folder: { id: string; name: string } | null;
    };

/**
 * What a token points at, or why it does not.
 *
 * The three refusals are separate so the page can say something useful — "expired"
 * and "the owner revoked this" are different things to a recipient — but they are
 * deliberately indistinguishable when the target is gone: a file that was trashed or
 * quarantined answers `not_found`, because a public link should not report on the
 * state of a stranger's file.
 *
 * Does not count an access. Rendering a page and fetching bytes are different
 * events, and a crawler fetching Open Graph tags is not a visit.
 */
export async function resolveShare(token: string): Promise<ShareState> {
  const admin = createAdminClient();
  const { data: share } = await admin.from("share_links").select("*").eq("token", token).maybeSingle();

  if (!share) return { kind: "not_found" };
  if (share.is_revoked) return { kind: "revoked" };
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return { kind: "expired" };

  let file: Extract<ShareState, { kind: "ready" }>["file"] = null;
  let folder: Extract<ShareState, { kind: "ready" }>["folder"] = null;

  if (share.file_id) {
    const { data } = await admin.from("files").select("*").eq("id", share.file_id).maybeSingle();
    if (data && !data.trashed_at && data.status === "ready") {
      file = {
        id: String(data.id),
        originalFilename: String(data.original_filename),
        category: String(data.category ?? "other"),
        sizeBytes: Number(data.size_bytes ?? 0),
        mimeType: data.mime_type ? String(data.mime_type) : null,
        createdAt: String(data.created_at),
        hasThumbnail: Boolean(data.thumbnail_url),
        objectKey: String(data.object_key),
      };
    }
  }

  if (share.folder_id) {
    const { data } = await admin.from("folders").select("*").eq("id", share.folder_id).maybeSingle();
    if (data && !data.trashed_at) folder = { id: String(data.id), name: String(data.name) };
  }

  if (!file && !folder) return { kind: "not_found" };

  return {
    kind: "ready",
    share: {
      id: String(share.id),
      ownerId: String(share.owner_id),
      fileId: share.file_id ? String(share.file_id) : null,
      folderId: share.folder_id ? String(share.folder_id) : null,
      token: String(share.token),
      permission: share.permission as "view" | "download",
      expiresAt: share.expires_at ? String(share.expires_at) : null,
      createdAt: String(share.created_at),
      accessCount: Number(share.access_count ?? 0),
    },
    file,
    folder,
  };
}

/** Records that someone actually opened the link. */
export async function countShareAccess(shareId: string, current: number): Promise<void> {
  const admin = createAdminClient();
  await admin.from("share_links").update({ access_count: current + 1 }).eq("id", shareId);
}
