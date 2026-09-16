import "server-only";
import { ApiError } from "@/lib/api/auth";
import { devRoute, devOptions } from "@/lib/api/v1";
import { requireOwnedFile } from "@/lib/services/fileOps";
import { resolveDelivery } from "@/lib/services/delivery";
import { mustDownload } from "@/lib/services/mime";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * GET /v1/files/:id/download-url — a short-lived URL that saves the file.
 *
 * Not bound to a browser session, unlike the app's own links: an API client has no
 * cookie to bind to. It is a capability with a short life, so treat it as one.
 */
export const GET = devRoute<Params, { url: string; expiresIn: number; filename: string }>(
  { scope: "files.read" },
  async (_req, { identity, params }) => {
    const file = await requireOwnedFile(identity.userId, params.id);
    if (String(file.status) !== "ready") throw new ApiError("FILE_NOT_READY", 409, "File is not available yet.");

    const filename = String(file.original_filename);
    const delivery = await resolveDelivery({
      objectKey: String(file.object_key),
      deliveryClass: "p",
      disposition: "attachment",
      filename,
      ...(file.mime_type ? { contentType: String(file.mime_type) } : {}),
      fallbackTtlSeconds: 3600,
    });
    // Nothing to decide here about executable types: an attachment is already the
    // safe disposition, and mustDownload is what the preview endpoint consults.
    void mustDownload;
    return { url: delivery.url, expiresIn: delivery.expiresIn, filename };
  },
);

export const OPTIONS = devOptions();
