import { handler, requireUser } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

// The client signs out its own Supabase session (supabase.auth.signOut()).
// This endpoint is a server-side hook for revocation bookkeeping if needed.
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  return { user: user.email, signedOut: true };
});
