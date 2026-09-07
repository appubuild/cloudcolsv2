import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

type Params = { fileId: string };

interface Body {
  action: "quarantine" | "release";
  reason?: string;
}

/**
 * Quarantine a file, or let it go again.
 *
 * The Storage Operations screen has had a Quarantine button since the beginning. It
 * opened a `window.prompt` for a reason, threw the answer away, showed "File
 * quarantined — hidden from owner + shares", and made no request. The file stayed
 * exactly where it was.
 *
 * What quarantining actually does now: the file's status leaves `ready`, and every
 * path that serves a file requires `ready` — the owner's download, the preview URL,
 * and a public share link all refuse it. It is left visible in the owner's own
 * listing, marked, rather than vanishing: a file that silently disappears is a
 * support ticket, and the owner is entitled to know something happened to it.
 *
 * A reason is required. This is an action taken against someone's data, and "who
 * did it and why" is the whole point of recording it.
 *
 * super_admin: hiding a customer's file is not a routine support action.
 */
export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const staff = await requireAdmin(req, "super_admin");
  const { fileId } = (await ctx?.params) ?? { fileId: "" };
  const body = (await req.json()) as Body;

  if (body.action !== "quarantine" && body.action !== "release") {
    throw new ApiError("INVALID_INPUT", 400, "action must be \"quarantine\" or \"release\".");
  }
  const reason = String(body.reason ?? "").trim();
  if (!reason || reason.length < 3) {
    throw new ApiError("REASON_REQUIRED", 400, "A reason is required, and is written to the audit log.");
  }

  const client = createAdminClient();
  const { data: file } = await client
    .from("files")
    .select("id, owner_id, original_filename, status")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");

  const quarantining = body.action === "quarantine";
  if (quarantining && file.status === "quarantined") {
    throw new ApiError("ALREADY_QUARANTINED", 409, "That file is already quarantined.");
  }
  if (!quarantining && file.status !== "quarantined") {
    throw new ApiError("NOT_QUARANTINED", 409, "That file is not quarantined.");
  }

  const { data: updated, error } = await client
    .from("files")
    .update({ status: quarantining ? "quarantined" : "ready" })
    .eq("id", fileId)
    .select("id, status")
    .single();
  if (error) throw new ApiError("UPDATE_FAILED", 400, error.message);

  await audit({
    actorId: staff.id,
    actorType: "admin",
    action: quarantining ? "admin.file_quarantined" : "admin.file_released",
    targetType: "file",
    targetId: String(file.id),
    metadata: {
      ownerId: String(file.owner_id),
      filename: String(file.original_filename),
      reason,
      adminEmail: staff.email,
    },
  });

  return { id: String(updated.id), status: String(updated.status) };
});
