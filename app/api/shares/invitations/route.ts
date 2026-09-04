import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Body {
  fileId?: string | null;
  folderId?: string | null;
  email: string;
  permission?: "viewer" | "editor";
  message?: string;
}

/**
 * Invite someone to a file or folder by email.
 *
 * Nothing in the response says whether the address has a CloudCols account. An
 * endpoint that answers "no such user" lets anyone test addresses against the
 * user list, and addresses are guessable. The invitation is created either way and
 * binds to an account when someone signs in with that address — which also means
 * a colleague can be invited before they have signed up.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || email.length > 320) {
    throw new ApiError("INVALID_INPUT", 400, "Enter a valid email address.");
  }
  if (email === user.email.toLowerCase()) {
    throw new ApiError("INVALID_INPUT", 400, "That is your own address.");
  }
  if (Boolean(body.fileId) === Boolean(body.folderId)) {
    throw new ApiError("INVALID_INPUT", 400, "Share either a file or a folder.");
  }

  const permission = body.permission === "editor" ? "editor" : "viewer";
  const admin = createAdminClient();

  // Ownership, checked here rather than trusted. Answered as NOT_FOUND rather
  // than FORBIDDEN: confirming an id exists would let someone probe for other
  // people's files.
  const table = body.fileId ? "files" : "folders";
  const id = body.fileId ?? body.folderId!;
  const { data: owned } = await admin
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .maybeSingle();
  if (!owned) throw new ApiError("NOT_FOUND", 404, "That item does not exist.");

  // The address may already belong to an account, in which case the invitation
  // is bound now rather than waiting for the sign-up trigger. Looked up through
  // the admin API and never reported back to the caller.
  let recipientId: string | null = null;
  try {
    // A definer function, because auth.users is not exposed through PostgREST.
    // EXECUTE on it is granted to service_role only, so it cannot be called from
    // a browser and turned into an account-enumeration oracle.
    const { data } = await admin.rpc("user_id_for_email", { p_email: email });
    recipientId = (data as string | null) ?? null;
  } catch {
    // Not fatal: the sign-up trigger binds the invitation instead.
  }
  if (recipientId === user.id) {
    throw new ApiError("INVALID_INPUT", 400, "That is your own address.");
  }

  // Re-inviting the same person updates the existing invitation rather than
  // stacking duplicates that would each have to be revoked separately.
  const row = {
    owner_id: user.id,
    file_id: body.fileId ?? null,
    folder_id: body.folderId ?? null,
    invited_email: email,
    recipient_id: recipientId,
    permission,
    status: "pending",
    message: body.message?.slice(0, 500) ?? null,
    responded_at: null,
  };

  const { data: existing } = await admin
    .from("share_invitations")
    .select("id")
    .eq("owner_id", user.id)
    .eq("invited_email", email)
    .eq(body.fileId ? "file_id" : "folder_id", id)
    .neq("status", "revoked")
    .maybeSingle();

  const { data: invitation, error } = existing
    ? await admin.from("share_invitations").update(row).eq("id", existing.id).select("*").single()
    : await admin.from("share_invitations").insert(row).select("*").single();
  if (error) throw error;

  // Tell the recipient, if we know who they are. Best effort: a failed
  // notification must not fail the invitation, which is the durable record.
  if (recipientId) {
    await admin
      .from("notifications")
      .insert({
        user_id: recipientId,
        type: "share_invitation",
        title: `${user.email} shared something with you`,
        body: body.message?.slice(0, 500) ?? "",
        link: "/app/shared",
      })
      .then(undefined, () => undefined);
  }

  return mapInvitation(invitation as Record<string, unknown>);
});

/**
 * Invitations, from both ends.
 *
 * `?direction=incoming` is what was shared with me; `outgoing` is what I shared.
 * The default is incoming, because that is the one with something to act on.
 */
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const outgoing = url.searchParams.get("direction") === "outgoing";
  const admin = createAdminClient();

  const query = admin
    .from("share_invitations")
    .select("*, files(original_filename, category, size_bytes), folders(name)")
    .order("created_at", { ascending: false })
    .limit(200);

  const { data, error } = outgoing
    ? await query.eq("owner_id", user.id).neq("status", "revoked")
    : await query.eq("recipient_id", user.id).neq("status", "revoked");
  if (error) throw error;

  return (data ?? []).map((r) => mapInvitation(r as Record<string, unknown>));
});

/** Shapes an invitation for whoever asked. The owner's id never leaves. */
function mapInvitation(row: Record<string, unknown>) {
  const file = row.files as { original_filename?: string; category?: string; size_bytes?: number } | null;
  const folder = row.folders as { name?: string } | null;
  return {
    id: String(row.id),
    fileId: row.file_id ? String(row.file_id) : null,
    folderId: row.folder_id ? String(row.folder_id) : null,
    invitedEmail: String(row.invited_email),
    permission: String(row.permission),
    status: String(row.status),
    message: row.message ? String(row.message) : null,
    createdAt: String(row.created_at),
    respondedAt: row.responded_at ? String(row.responded_at) : null,
    itemName: file?.original_filename ?? folder?.name ?? "Shared item",
    itemKind: row.file_id ? ("file" as const) : ("folder" as const),
    category: file?.category ?? null,
    sizeBytes: file?.size_bytes ?? null,
  };
}
