"use client";

import { getAdminToken } from "@/lib/store/admin";

/**
 * Calls an admin endpoint with the staff session token.
 *
 * Separate from the user API client on purpose: admin sessions are a different
 * identity with a different token and a different lifetime, and one helper that
 * sometimes sends one and sometimes the other is how a request ends up carrying
 * the wrong credential.
 */
export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });

  const body = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } }
    | null;

  if (!res.ok || !body || body.ok === false) {
    const message = body && body.ok === false ? body.error.message : `Request failed (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return body.data;
}
