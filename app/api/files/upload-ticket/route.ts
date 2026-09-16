import "server-only";
import { limited, requireUser, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createUploadTicket } from "@/lib/services/fileOps";

export const dynamic = "force-dynamic";

interface Body {
  filename: string;
  sizeBytes: number;
  mimeType?: string;
  folderId?: string | null;
}

/**
 * Somewhere to send the bytes.
 *
 * The rules — quota, folder ownership, how a large file is split — live in
 * lib/services/fileOps, because the Developer API grants the same thing and the two
 * must not drift.
 */
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  return createUploadTicket(user.id, {
    filename: body.filename,
    sizeBytes: body.sizeBytes,
    ...(body.mimeType ? { mimeType: body.mimeType } : {}),
    folderId: body.folderId ?? null,
  });
}, DEFAULT_LIMITS.uploadTicket);
