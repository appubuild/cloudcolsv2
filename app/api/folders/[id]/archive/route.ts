import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveDelivery } from "@/lib/services/delivery";
import { establishDeliverySession } from "@/lib/api/deliverySession";
import { archiveEntries, type ArchiveFolder } from "@/lib/services/archive";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * What a folder contains, as a list of files with somewhere to fetch each from.
 *
 * The browser builds the zip itself (lib/services/folderZip.ts): it reads each URL
 * from the CDN and writes the archive straight to disk. Nothing is zipped here,
 * because zipping here would mean every byte of every file passing through the
 * Worker — the one thing this architecture does not do. That is why folder download
 * "was not available yet" for so long; it needed the browser to do the assembling.
 *
 * Paged, because a folder can hold thousands of files and each entry carries a signed
 * URL that should not be minted long before it is used.
 */
export const GET = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const url = new URL(req.url);

  const admin = createAdminClient();
  const { data: root } = await admin
    .from("folders")
    .select("id, name, trashed_at")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!root || root.trashed_at) throw new ApiError("FOLDER_NOT_FOUND", 404, "Folder not found.");

  // One cookie for the whole archive: every URL below is bound to this account, and
  // the CDN checks the two against each other.
  const boundTo = await establishDeliverySession(req, user.id);

  const page = await archiveEntries({
    ownerId: user.id,
    root: { id: String(root.id), name: String(root.name) } satisfies ArchiveFolder,
    cursor: url.searchParams.get("cursor"),
    limit: Number(url.searchParams.get("limit") ?? 0),
    countTotal: !url.searchParams.get("cursor"),
    deliver: (file) =>
      resolveDelivery({
        objectKey: file.objectKey,
        deliveryClass: "p",
        disposition: "attachment",
        filename: file.filename,
        ...(file.mimeType ? { contentType: file.mimeType } : {}),
        userId: boundTo,
        fallbackTtlSeconds: 3600,
      }),
  });

  return { folderName: String(root.name), ...page };
});
