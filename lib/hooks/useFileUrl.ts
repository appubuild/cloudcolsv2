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
export function useFileUrl(fileId: string | null, enabled = true, variant: "full" | "thumb" | "source" = "full") {
  const me = useAuthStore((s) => s.user);

  return useQuery({
    // The variant is part of the key: a thumbnail URL and a full-file URL are
    // different things, and sharing one cache entry between them would hand the
    // grid a full-size original or the viewer a 512 px thumbnail.
    queryKey: ["fileUrl", fileId, variant],
    enabled: Boolean(fileId) && Boolean(me) && enabled,
    /**
     * Held for half an hour, which is what makes replaying a video fast.
     *
     * A signed URL is a cache key. Mint a new one and the browser has never seen it,
     * so every byte it already holds is unreachable and a re-opened video starts from
     * storage again. Keeping the same string means the browser's own HTTP cache
     * answers instead.
     *
     * Thirty minutes because that is comfortably inside the shortest lifetime any
     * delivery path issues — a private ticket lives 50 to 60 minutes and the presigned
     * fallback an hour — so a reused URL is never an expired one.
     */
    staleTime: 30 * 60_000,
    gcTime: 30 * 60_000,
    // A signed URL that failed will not succeed on a retry with the same inputs.
    retry: 0,
    queryFn: () => filesRepo.getDownloadUrl(me!.id, fileId!, "inline", variant),
  });
}
