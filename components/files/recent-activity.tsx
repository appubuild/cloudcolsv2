"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useAuthStore } from "@/lib/store/auth";
import { FileThumb } from "./file-thumb";
import { FolderGlyph } from "./folder-icon";
import { Skeleton } from "@/components/ui/misc";
import { formatBytes } from "@/lib/utils";
import type { FileCategory } from "@/lib/types";

interface Activity {
  id: string;
  action: string;
  occurredAt: string;
  kind: "file" | "folder";
  targetId: string;
  name: string;
  category: string | null;
  sizeBytes: number | null;
  icon: string | null;
}

/**
 * "Downloaded 5 minutes ago" rather than "touched at some point".
 *
 * Separate from Recent Access, which sorts by last_accessed_at and can only say
 * that something happened. This says what, which is what makes the list worth
 * reading: finding the file you downloaded this morning is a different search from
 * finding the one you opened.
 */
const VERB: Record<string, string> = {
  opened: "Opened",
  previewed: "Previewed",
  downloaded: "Downloaded",
  uploaded: "Uploaded",
  modified: "Edited",
  shared: "Shared",
};

/** "5 minutes ago" — relative, because that is how people think about recency. */
function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export function RecentActivity({ limit = 8 }: { limit?: number }) {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading } = useQuery({
    queryKey: ["activity", limit],
    queryFn: () => apiClient.get<{ items: Activity[] }>(`/api/activity?limit=${limit}`),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Nothing yet. Open or download a file and it will show up here.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 py-2.5">
          {item.kind === "folder" ? (
            <FolderGlyph icon={item.icon} className="h-9 w-9" iconClassName="h-4 w-4" />
          ) : (
            <FileThumb
              fileId={item.targetId}
              category={(item.category ?? "other") as FileCategory}
              alt={item.name}
              className="h-9 w-9"
            />
          )}
          <div className="min-w-0 flex-1">
            <Link
              href={item.kind === "folder" ? `/app/files/${item.targetId}` : "/app/recent"}
              className="block truncate text-sm font-medium text-foreground hover:text-primary"
            >
              {item.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {VERB[item.action] ?? item.action} {ago(item.occurredAt)}
              {item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
