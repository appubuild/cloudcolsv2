import "server-only";
import { devRoute, devOptions } from "@/lib/api/v1";
import { createUploadTicket } from "@/lib/services/fileOps";

export const dynamic = "force-dynamic";

interface Body {
  filename?: string;
  sizeBytes?: number;
  mimeType?: string;
  folderId?: string | null;
}

/**
 * POST /v1/files/upload — somewhere to PUT the bytes.
 *
 * The bytes go straight from the client to storage; nothing uploads through this API.
 * The file exists only once POST /v1/files/:id/confirm has been called and storage has
 * confirmed what it holds.
 */
export const POST = devRoute({ scope: "files.write" }, async (req, { identity }) => {
  const body = (await req.json().catch(() => ({}))) as Body;
  const ticket = await createUploadTicket(identity.userId, {
    filename: String(body.filename ?? ""),
    sizeBytes: Number(body.sizeBytes ?? NaN),
    ...(body.mimeType ? { mimeType: body.mimeType } : {}),
    folderId: body.folderId ?? null,
  });

  return {
    fileId: ticket.fileId,
    uploadUrl: ticket.presignedUrl || null,
    expiresIn: ticket.expiresIn,
    multipart: ticket.multipart,
    partSizeBytes: ticket.partSizeBytes,
    partCount: ticket.partCount,
    multipartUploadId: ticket.multipartUploadId,
    confirmWith: `/v1/files/${ticket.fileId}/confirm`,
  };
});

export const OPTIONS = devOptions();
