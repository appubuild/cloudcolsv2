import "server-only";
import { devRoute, devOptions, publicFile } from "@/lib/api/v1";
import { requireOwnedFile, deleteFile } from "@/lib/services/fileOps";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** GET /v1/files/:id — metadata for one file. */
export const GET = devRoute<Params, ReturnType<typeof publicFile>>({ scope: "files.read" }, async (_req, { identity, params }) =>
  publicFile(await requireOwnedFile(identity.userId, params.id)),
);

/**
 * DELETE /v1/files/:id — to the trash, or `?permanent=true` to remove it for good.
 *
 * Trash by default: an API client deleting the wrong thing should be recoverable, and
 * the trash is what makes that true.
 */
export const DELETE = devRoute<Params, { deleted: true; permanent: boolean }>(
  { scope: "files.write" },
  async (req, { identity, params }) => {
    const permanent = new URL(req.url).searchParams.get("permanent") === "true";
    await deleteFile(identity.userId, params.id, permanent);
    return { deleted: true, permanent };
  },
);

export const OPTIONS = devOptions();
