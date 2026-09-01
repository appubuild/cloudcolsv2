import { handler } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

// Admin logout is a no-op server-side (the admin token is short-lived and
// stateless); the client discards its bearer token. Kept stable for symmetry.
export const POST = handler(async () => {
  return { loggedOut: true };
});
