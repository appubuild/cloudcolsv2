import "server-only";
import { devRoute, devOptions } from "@/lib/api/v1";
import { createShareLink } from "@/lib/services/fileOps";
import { appOrigin } from "@/lib/api/session";

export const dynamic = "force-dynamic";

type Params = { id: string };

interface Body {
  permission?: "view" | "download";
  expiresAt?: string | null;
}

/** POST /v1/files/:id/share — a public link to one of the account's files. */
export const POST = devRoute<Params, { id: string; token: string; url: string; permission: string; expiresAt: string | null }>(
  { scope: "shares.write" },
  async (req, { identity, params }) => {
    const body = (await req.json().catch(() => ({}))) as Body;
    const share = await createShareLink(identity.userId, {
      fileId: params.id,
      permission: body.permission,
      expiresAt: body.expiresAt ?? null,
    });
    const token = String(share.token);
    return {
      id: String(share.id),
      token,
      url: `${appOrigin(req)}/s/${token}`,
      permission: String(share.permission),
      expiresAt: share.expires_at ? String(share.expires_at) : null,
    };
  },
);

export const OPTIONS = devOptions();
