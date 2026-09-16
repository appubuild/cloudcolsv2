import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { createShareLink } from "@/lib/services/fileOps";

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
  // Ownership of what is being shared is checked inside createShareLink, which the
  // Developer API uses as well: this route writes with the service-role client, and
  // without that check anyone who learned another account's file id could mint a link
  // to it under their own name.
  const share = await createShareLink(user.id, {
    fileId: body.fileId ?? null,
    folderId: body.folderId ?? null,
    permission: body.permission,
    expiresAt: body.expiresAt ?? null,
  });
  return mapShare(share);
});
