"use client";

// Supabase auth session store + API fetch helper.
// Clients attach the Supabase access token as a Bearer header; the server
// validates it and derives the user id server-side (never trusted from client).

import { createClient } from "@supabase/supabase-js";
import { publicConfig } from "@/lib/config/public-config";

let supabase: ReturnType<typeof createClient> | null = null;

/**
 * The browser's Supabase client, used for sign-in and for the session token that
 * every API call carries.
 *
 * Configuration comes from publicConfig(), which the server fills in from the
 * Worker's bindings. Reading NEXT_PUBLIC_* here instead meant sign-in failed with
 * "Supabase not configured on this deployment" on a deployment where the values
 * were plainly set — they were simply not present when the bundle was built.
 */
export function auth() {
  const { supabaseUrl, supabaseAnonKey } = publicConfig();
  if (!supabaseUrl || !supabaseAnonKey) return null;
  if (!supabase) supabase = createClient(supabaseUrl, supabaseAnonKey);
  return supabase;
}

export class ApiClientError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function getToken(): Promise<string | null> {
  const sb = auth();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

// Admin calls use the separate staff token (never the end-user session).
function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("cloudcols.admin.token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isAdmin = path.startsWith("/api/admin/");
  const token = isAdmin ? getAdminToken() : await getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
