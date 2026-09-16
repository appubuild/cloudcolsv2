import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { confirmUpload } from "@/lib/services/fileOps";

export const dynamic = "force-dynamic";

interface Body {
  uploadId: string;
  fileId: string;
}

/**
 * The upload is finished — if storage agrees.
 *
 * Shared with the Developer API (lib/services/fileOps): storage is asked what it
 * actually holds, and a file whose size does not match what was declared is refused
 * and removed, because the quota check happened against the declared number.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  return confirmUpload(user.id, body.fileId);
});
