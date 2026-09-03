"use client";

import { useQuery } from "@tanstack/react-query";
import { filesRepo } from "@/lib/repositories";
import { useAuthStore } from "@/lib/store/auth";

/**
 * A readable URL for one stored file.
 *
 * The URL is signed and expires, so it is cached for less than its lifetime and
 * never kept across a session. Nothing here proves access — the server checks
 * ownership before it signs anything.
 */
export function useFileUrl(fileId: string | null, enabled = true) {
  const me = useAuthStore((s) => s.user);

  return useQuery({
    queryKey: ["fileUrl", fileId],
    enabled: Boolean(fileId) && Boolean(me) && enabled,
    // The server signs for 10 minutes; refetch well inside that.
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    // A signed URL that failed will not succeed on a retry with the same inputs.
    retry: 0,
    queryFn: () => filesRepo.getDownloadUrl(me!.id, fileId!),
  });
}
