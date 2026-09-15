"use client";

import { clearAdminSession } from "@/lib/store/admin";

/**
 * Calls an admin endpoint with the staff session.
 *
 * The session is the httpOnly cc_admin cookie, which the browser attaches itself; this
 * helper never sees a token. A 401 means the staff session is gone (six hours, or signed
 * out elsewhere), so the console's cached role is dropped and the page goes back to the
 * sign-in screen instead of showing a panel whose every call fails.
 */
export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.headers ?? {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });

  const body = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } }
    | null;

  if (res.status === 401 && typeof window !== "undefined") {
    clearAdminSession();
    if (!window.location.pathname.startsWith("/admin/login")) window.location.assign("/admin/login");
  }

  if (!res.ok || !body || body.ok === false) {
    const message = body && body.ok === false ? body.error.message : `Request failed (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return body.data;
}
