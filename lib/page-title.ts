"use client";

import { create } from "zustand";

const BRAND = "CloudCols";

/**
 * Titles for the routes whose name is fixed.
 *
 * Longest match wins, so /app/files/<id> falls back to "My Files" until the page
 * knows the folder's name and overrides it.
 */
const ROUTE_TITLES: [pattern: string, title: string][] = [
  ["/app/files", "My Files"],
  ["/app/recent", "Recent"],
  ["/app/favorites", "Favorites"],
  ["/app/shared", "Shared"],
  ["/app/trash", "Trash"],
  ["/app/storage", "Storage"],
  ["/app/settings", "Settings"],
  ["/app/images", "Images"],
  ["/app/videos", "Videos"],
  ["/app/documents", "Documents"],
  ["/app/pdf", "PDF"],
  ["/app/audio", "Audio"],
  ["/app/other", "Other files"],
  ["/app", "Dashboard"],
  ["/login", "Sign in"],
  ["/register", "Create account"],
  ["/forgot-password", "Reset password"],
  ["/developers/api-keys", "API keys"],
  ["/developers/webhooks", "Webhooks"],
  ["/developers/usage", "API usage"],
  ["/developers/billing", "Developer billing"],
  ["/developers/docs", "API docs"],
  ["/developers", "Developers"],
  ["/admin", "Admin"],
  ["/pricing", "Pricing"],
  ["/features", "Features"],
  ["/security", "Security"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
];

export function titleForPath(pathname: string): string {
  const match = ROUTE_TITLES.find(([pattern]) => pathname === pattern || pathname.startsWith(`${pattern}/`));
  return match ? `${BRAND} — ${match[1]}` : BRAND;
}

/**
 * A title a page knows but the route does not — a folder's name, a search term.
 *
 * Kept in a store rather than written to document.title directly, so the route
 * watcher and the page are not two things assigning the same value in an order
 * that depends on which effect runs first.
 */
interface TitleState {
  override: string | null;
  setOverride: (title: string | null) => void;
}

export const useTitleOverride = create<TitleState>((set) => ({
  override: null,
  setOverride: (override) => set({ override }),
}));

export function documentTitle(pathname: string, override: string | null): string {
  return override ? `${BRAND} — ${override}` : titleForPath(pathname);
}
