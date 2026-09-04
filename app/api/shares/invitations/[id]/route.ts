import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { id: string };

interface Body {
  /** accept and decline are the recipient's; revoke is the owner's. */
  action: "accept" | "decline" | "revoke";
}

/**
 * Responding to an invitation.
 *
 * Who may do what is decided by which side of the invitation the caller is on,
 * and that is read from the row rather than taken from the request. A recipient
 * cannot revoke, and an owner cannot accept on someone's behalf.
 *
 * Access follows status directly — the read policies in 0010 hang on
 * status = 'accepted' — so declining or revoking withdraws it in the same
 * statement, with no second place to remember to clean up.
 */
export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const body = (await req.json()) as Body;
  const admin = createAdminClient();

  const { data: invitation } = await admin
    .from("share_invitations")
    .select("id, owner_id, recipient_id, invited_email, status")
    .eq("id", id)
    .maybeSingle();

  // NOT_FOUND rather than FORBIDDEN for a stranger's invitation: confirming the
  // id exists is itself a leak.
  const isOwner = invitation?.owner_id === user.id;
  const isRecipient =
    invitation?.recipient_id === user.id ||
    String(invitation?.invited_email ?? "") === user.email.toLowerCase();
  if (!invitation || (!isOwner && !isRecipient)) {
    throw new ApiError("NOT_FOUND", 404, "That invitation does not exist.");
  }

  if (body.action === "revoke") {
    if (!isOwner) throw new ApiError("FORBIDDEN", 403, "Only the owner can revoke access.");
  } else if (!isRecipient) {
    throw new ApiError("FORBIDDEN", 403, "Only the person invited can respond.");
  }

  if (invitation.status === "revoked") {
    throw new ApiError("CONFLICT", 409, "That invitation was withdrawn.");
  }

  const status = body.action === "accept" ? "accepted" : body.action === "decline" ? "declined" : "revoked";

  const updates: Record<string, unknown> = { status, responded_at: new Date().toISOString() };
  // Accepting is also what binds the invitation to the account, for one that was
  // addressed to an email before that account existed.
  if (isRecipient && !invitation.recipient_id) updates.recipient_id = user.id;

  const { data, error } = await admin
    .from("share_invitations")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  // Let the owner know the outcome. Best effort: the invitation row is the record
  // that matters, and a failed notification must not undo the response.
  if (!isOwner && data) {
    await admin
      .from("notifications")
      .insert({
        user_id: invitation.owner_id,
        type: "share_response",
        title: `${user.email} ${status} your share`,
        body: "",
        link: "/app/shared",
      })
      .then(undefined, () => undefined);
  }

  return { id: String(data.id), status: String(data.status) };
});
