"use client";

import { useUsageSummary } from "@/lib/hooks/queries";
import { CategoryThumb } from "./category-thumb";
import { Skeleton } from "@/components/ui/misc";
import { formatBytes } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/lib/storage/categories";
import type { FileCategory } from "@/lib/types";

/**
 * What each kind of file is costing, under the storage ring.
 *
 * The ring answers "how full am I"; these answer "with what". Categories with
 * nothing in them are left out rather than shown as zeroes — a row of empty cards
 * is noise, and the set of categories a given account uses is usually small.
 */
export function CategoryUsageCards() {
  const { data, isLoading } = useUsageSummary();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[76px] rounded-xl" />
        ))}
      </div>
    );
  }

  const rows = (data ?? []).filter((r) => r.count > 0);
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, r) => sum + r.bytes, 0);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map((row) => {
        const share = total > 0 ? Math.round((row.bytes / total) * 100) : 0;
        return (
          <div
            key={row.category}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
          >
            <CategoryThumb category={row.category as FileCategory} className="h-9 w-9" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">
                {CATEGORY_LABELS[row.category as FileCategory]}
              </p>
              <p className="truncate text-sm font-semibold text-foreground tabular-nums">
                {formatBytes(row.bytes)}
              </p>
              <p className="truncate text-[11px] text-muted-foreground tabular-nums">
                {row.count} file{row.count === 1 ? "" : "s"} · {share}%
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
