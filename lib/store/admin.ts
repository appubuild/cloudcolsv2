"use client";

import { useEffect, useState } from "react";

// Admin session is SEPARATE from the end-user session (per the brief).
// In api mode we store the server-issued admin JWT + role; in mock mode we keep
// the demo role. The token is never persisted in a way that's readable by the
// user-auth client bundle's secrets (it's a short-lived staff JWT).

const TOKEN_KEY = "cloudcols.admin.token";
const ROLE_KEY = "cloudcols.admin.role";

export interface AdminSession {
  token: string | null;
  role: string | null;
}

export function saveAdminSession(token: string, role: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
}

export function clearAdminSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getAdminRole(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ROLE_KEY);
}

export function useAdminSession(): AdminSession {
  const [session, setSession] = useState<AdminSession>({ token: null, role: null });
  useEffect(() => {
    setSession({ token: getAdminToken(), role: getAdminRole() });
  }, []);
  return session;
}
