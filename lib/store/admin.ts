"use client";

import { useEffect, useState } from "react";

// The staff session lives in an httpOnly cookie (cc_admin) that page script cannot
// read — it used to be a token in localStorage, readable by anything on the page.
// What is kept here is only the role, and only to decide what to draw: every admin
// endpoint checks the real session and the live role on each call.

const ROLE_KEY = "cloudcols.admin.role";
/** Where the token used to be stored. Removed on sight from browsers that still have it. */
const LEGACY_TOKEN_KEY = "cloudcols.admin.token";

export interface AdminSession {
  role: string | null;
}

function dropLegacyToken(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function saveAdminSession(role: string): void {
  try {
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    /* storage unavailable: the role is only cosmetic */
  }
  dropLegacyToken();
}

export function clearAdminSession(): void {
  try {
    localStorage.removeItem(ROLE_KEY);
  } catch {
    /* storage unavailable */
  }
  dropLegacyToken();
}

/** Signs out of the console: clears the role here and the httpOnly cookie on the server. */
export async function signOutAdmin(): Promise<void> {
  clearAdminSession();
  await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
}

export function getAdminRole(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ROLE_KEY);
  } catch {
    return null;
  }
}

export function useAdminSession(): AdminSession {
  const [session, setSession] = useState<AdminSession>({ role: null });
  useEffect(() => {
    dropLegacyToken();
    setSession({ role: getAdminRole() });
  }, []);
  return session;
}
