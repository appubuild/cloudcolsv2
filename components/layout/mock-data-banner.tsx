"use client";

import { AlertTriangle } from "lucide-react";
import { useApi } from "@/lib/repositories";

/**
 * Says so, loudly, when the app is running on fabricated data.
 *
 * Mock mode is indistinguishable from the real thing from the inside: sign-in
 * succeeds, uploads report success, files appear in the list. A deployment that
 * missed NEXT_PUBLIC_DATA_LAYER at build time therefore looks like a working
 * product with mysterious bugs — images that never get a thumbnail, a list that
 * needs a reload — rather than an app that is not connected to anything.
 */
export function MockDataBanner() {
  if (useApi) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-xs font-medium text-white"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        Demo data. Nothing here is saved — this build was made with{" "}
        <code className="font-mono">NEXT_PUBLIC_DATA_LAYER=mock</code>.
      </span>
    </div>
  );
}
