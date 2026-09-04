"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { documentTitle, useTitleOverride } from "@/lib/page-title";

/**
 * Keeps the browser tab's title in step with the route.
 *
 * Every page in the app is a client component, so none of them can export Next's
 * `metadata` — which is why the tab kept saying whatever the first page loaded
 * said, however far the user navigated. One watcher here beats a useEffect in
 * thirty files.
 */
export function RouteTitle() {
  const pathname = usePathname();
  const override = useTitleOverride((s) => s.override);

  useEffect(() => {
    document.title = documentTitle(pathname ?? "/", override);
  }, [pathname, override]);

  // A page's override belongs to that page; leaving it set would title the next
  // route with the last folder's name.
  useEffect(() => () => useTitleOverride.getState().setOverride(null), [pathname]);

  return null;
}
