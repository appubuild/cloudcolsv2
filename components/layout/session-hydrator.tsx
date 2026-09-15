"use client";

import { useEffect } from "react";
import { hasSessionHint } from "@/lib/api/client";
import { authRepo, useApi } from "@/lib/repositories";
import { useAuthStore } from "@/lib/store/auth";

/**
 * Tells the rest of the app who is signed in, on every page.
 *
 * Mounted in the root layout so every page is covered once. The session itself is in
 * httpOnly cookies (lib/api/session.ts) that script cannot read, so the server is asked
 * — but only when the readable hint cookie says there is a session to ask about. A
 * signed-out visitor on the marketing site costs nothing, and most of them are.
 */
export function SessionHydrator() {
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    if (!useApi) {
      // Mock mode has no server session; whatever the sign-in form put in the store is
      // all there is.
      useAuthStore.setState({ loading: false });
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (!hasSessionHint()) {
        setUser(null);
        return;
      }
      try {
        const me = await authRepo.getCurrentUser();
        if (!cancelled) setUser(me);
      } catch {
        // A session the server will not accept — expired for good, or the account was
        // suspended or deleted. Treated as signed out rather than left half-loaded.
        if (!cancelled) setUser(null);
      }
    };

    void load();

    // Tabs share cookies. Signing out in one clears the hint for all of them; signing
    // in sets it. Checked when a tab comes back into view, so it never shows a session
    // that is gone, or a sign-in page to someone who has since signed in.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const signedIn = hasSessionHint();
      const current = useAuthStore.getState().user;
      if (!signedIn && current) setUser(null);
      if (signedIn && !current) void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [setUser]);

  return null;
}
