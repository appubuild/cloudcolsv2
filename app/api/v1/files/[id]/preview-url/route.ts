import "server-only";
import { ApiError } from "@/lib/api/auth";
import { devRoute, devOptions } from "@/lib/api/v1";
import { requireOwnedFile } from "@/lib/services/fileOps";
import { resolveDelivery } from "@/lib/services/delivery";
import { mustDownload } from "@/lib/services/mime";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * GET /v1/files/:id/preview-url — a short-lived URL that displays the file, or its
 * thumbnail with `?variant=thumb`.
 *
 * Anything a browser would execute (.html, .svg) is served as an attachment whatever
 * was asked for: a convincing page hosted on storage a visitor half-recognises is a
 * good phishing page.
 */
export const GET = devRoute<Params, { url: string; expiresIn: number; variant: "file" | "thumb" }>(
  { scope: "files.read" },
  async (req, { identity, params }) => {
    const file = await requireOwnedFile(identity.userId, params.id);
    if (String(file.status) !== "ready") throw new ApiError("FILE_NOT_READY", 409, "File is not available yet.");

    const wantsThumb = new URL(req.url).searchParams.get("variant") === "thumb";
    if (wantsThumb) {
      const key = file.thumbnail_url ? String(file.thumbnail_url) : "";
      if (!key) throw new ApiError("NO_THUMBNAIL", 404, "This file has no thumbnail.");
      const thumb = await resolveDelivery({
        objectKey: key,
        deliveryClass: "t",
        disposition: "inline",
        contentType: "image/webp",
        fallbackTtlSeconds: 3600,
      });
      return { url: thumb.url, expiresIn: thumb.expiresIn, variant: "thumb" as const };
    }

    const forced = mustDownload(String(file.original_filename), file.mime_type ? String(file.mime_type) : null);
    const delivery = await resolveDelivery({
      objectKey: String(file.object_key),
      deliveryClass: "p",
      disposition: forced ? "attachment" : "inline",
      filename: String(file.original_filename),
      ...(file.mime_type ? { contentType: String(file.mime_type) } : {}),
      fallbackTtlSeconds: 3600,
    });
    return { url: delivery.url, expiresIn: delivery.expiresIn, variant: "file" as const };
  },
);

export const OPTIONS = devOptions();
