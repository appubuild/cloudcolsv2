import "server-only";
import { devRoute, devOptions, publicFile } from "@/lib/api/v1";
import { confirmUpload, requireOwnedFile } from "@/lib/services/fileOps";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * POST /v1/files/:id/confirm — the upload is finished.
 *
 * Storage is asked what it actually holds: a file whose size does not match what was
 * declared is refused and removed, because the quota check happened against the
 * declared number.
 */
export const POST = devRoute<Params, ReturnType<typeof publicFile>>(
  { scope: "files.write" },
  async (_req, { identity, params }) => {
    await confirmUpload(identity.userId, params.id);
    return publicFile(await requireOwnedFile(identity.userId, params.id));
  },
);

export const OPTIONS = devOptions();
