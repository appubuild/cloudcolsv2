"use client";

import { useEffect } from "react";
import { auth } from "@/lib/api/client";
import { authRepo, useApi } from "@/lib/repositories";
import { useAuthStore } from "@/lib/store/auth";

/**
 * Tells the rest of the app who is signed in, on every page.
 *
 * The auth store was only ever filled in two places: by the sign-in form, and by
 * AppShell — which mounts only under /app. Everywhere else it stayed null on a fresh
 * load even with a perfectly good session in the browser. So the marketing header
 * offered "Sign in" to people who were already signed in, and /login and /register
 * happily showed their forms instead of sending them to the app. Both had components
 * written to handle exactly that; neither had anything to read.
 *
 * Mounted in the root layout so every page is covered once.
 *
 * The local session is checked first, with no network call. A signed-out visitor on
 * the marketing site should cost nothing, and the great majority of them are.
 */
export function SessionHydrator() {
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    if (!useApi) {
      // Mock mode has no Supabase session to read; whatever the sign-in form put in
      // the store is all there is.
      useAuthStore.setState({ loading: false });
      return;
    }

    const sb = auth();
    if (!sb) {
      setUser(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      const { data } = await sb.auth.getSession();
      if (cancelled) return;

      if (!data.session) {
        setUser(null);
        return;
      }
      try {
        const me = await authRepo.getCurrentUser();
        if (!cancelled) setUser(me);
      } catch {
        // A session that the server will not accept — expired, or the account was
        // suspended or deleted. Treated as signed out rather than left half-loaded,
        // which is what would strand the UI on a spinner.
        if (!cancelled) setUser(null);
      }
    };

    void load();

    // Signing out in another tab, or a token refresh failing, should be visible here
    // too — otherwise this tab keeps showing a session that is gone.
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setUser(null);
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") void load();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [setUser]);

  return null;
}
