"use client";

import Link from "next/link";
import { useFiles } from "@/lib/hooks/queries";
import { CategoryThumb } from "./category-thumb";
import { Skeleton } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { formatBytes, formatDate } from "@/lib/utils";
import type { File } from "@/lib/types";

export function RecentFilesStrip() {
  const { data, isLoading } = useFiles({ recent: true, sort: "accessed", order: "desc", pageSize: 6 });

  return (
    <Card>
      <div className="flex items-center justify-between p-5 pb-2">
        <h3 className="text-base font-semibold text-foreground">Recently accessed</h3>
        <Link href="/app/recent" className="text-sm font-medium text-primary hover:underline">View all</Link>
      </div>
      <div className="px-5 pb-5">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No recently accessed files.</p>
        ) : (
          <div className="divide-y divide-border">
            {(data?.items ?? []).slice(0, 4).map((item) => {
              const file = item as File;
              if (!("sizeBytes" in item)) return null;
              return (
                <div key={item.id} className="flex items-center gap-3 py-2.5">
                  <CategoryThumb category={file.category} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{file.originalFilename}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(file.sizeBytes)} · {formatDate(file.lastAccessedAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
