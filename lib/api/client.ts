"use client";

// Calls to the app's own /api routes.
//
// The session is not handled here any more. It lives in httpOnly cookies the server
// sets at sign-in and renews as it goes (lib/api/session.ts), and the browser attaches
// them to same-origin requests by itself. Page script never sees a token, so script
// that should not be on the page cannot take one either. Staff sessions work the same
// way, with their own cookie.

export class ApiClientError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Whether this browser appears to be signed in, without a request.
 *
 * Reads a cookie that says only "1". The real session cookies are unreadable to script
 * by design; this one exists so a signed-out visitor costs no "who am I?" call.
 */
export function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)cc_signed_in=1(?:;|$)/.test(document.cookie);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiClientError(json?.error?.code ?? "UNKNOWN", res.status, json?.error?.message ?? "Request failed.");
  }
  return (json?.data ?? json) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
