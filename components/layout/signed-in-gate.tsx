"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth";

/**
 * Sends a signed-in visitor away from the sign-in and sign-up pages.
 *
 * Reaching them while already signed in is confusing at best: the form appears to
 * offer something that has already happened, and signing in again would replace a
 * perfectly good session.
 *
 * A `plan` in the query is carried through, so someone who arrives from the
 * pricing page while already signed in lands on the upgrade rather than being
 * dropped at the dashboard with no idea what became of their choice.
 */
export function SignedInGate() {
  const router = useRouter();
  const params = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  useEffect(() => {
    // `user` is null both when nobody is signed in and before the session has been
    // read. Acting on the first without waiting for the second is why this component
    // existed and never fired: the store was empty on every page except /app.
    if (loading || !user) return;
    const plan = params.get("plan");
    router.replace(plan ? `/app/storage?plan=${encodeURIComponent(plan)}` : "/app");
  }, [user, loading, params, router]);

  return null;
}
