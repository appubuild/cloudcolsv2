// Checking an email and password — on a client of its own.
//
// signInWithPassword stores the resulting session on the client that made the call,
// and supabase-js then sends that user's token, not the key the client was created
// with, on every later database call. The login route used to sign in on the
// service-role client and then write last_login_at with it: the write went out as the
// user, was refused, and the refusal was never checked. Not one account ever had
// last_login_at set, so the inactivity policy measured every account from signup.
//
// So a password check gets a throwaway client on the publishable key, and whatever
// the caller writes afterwards goes through createAdminClient() as it should.

import "server-only";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/config/server-env";

export async function checkPassword(
  email: string,
  password: string,
): Promise<{ session: Session; user: User } | null> {
  const client = createClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) return null;
  return { session: data.session, user: data.user };
}
