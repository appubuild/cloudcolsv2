"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * One QueryClient for the browser session.
 *
 * It used to be created inside Providers with useState, which meant nothing
 * outside the React tree could reach it. The upload service is a plain module, so
 * it had no way to tell the file list that a new file existed — which is why an
 * upload only appeared after a manual reload.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: 0 },
  },
});

/**
 * Refreshes everything that shows files, after an upload or a change to one.
 *
 * Broad on purpose: the same file appears in the folder listing, the category
 * pages, Recent, the dashboard and the storage total, and a user who just watched
 * an upload finish expects to see it in all of them.
 */
export function refreshFileViews(): void {
  for (const key of [
    "files",
    "trash",
    "usageSummary",
    "folders",
    "favoriteFolders",
    "recentFolders",
    "recentAccess",
    "me",
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}
