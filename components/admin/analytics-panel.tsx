"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { CategoryThumb } from "@/components/files/category-thumb";
import { adminFetch } from "@/lib/api/adminClient";
import { formatBytes } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import type { FileCategory } from "@/lib/types";

interface Analytics {
  truncated: boolean;
  scannedFiles: number;
  users: { total: number; active: number; new7d: number };
  storage: {
    usedBytes: number;
    allocatedBytes: number;
    fileCount: number;
    folderCount: number;
    byCategory: { category: string; bytes: number; count: number }[];
    byPlan: { planId: string; accounts: number; bytes: number }[];
  };
  largestFiles: { ownerId: string; filename: string; category: string; sizeBytes: number }[];
  topUsers: { userId: string; bytes: number }[];
  payments: {
    succeededCount: number;
    failedCount: number;
    pendingCount: number;
    refundedCount: number;
    grossCents: number;
    last30dCents: number;
  };
  subscriptions: { active: number; cancelled: number; pastDue: number };
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Platform figures, all derived from the rows.
 *
 * Nothing here is a stored counter, because a counter that has drifted is exactly
 * what this panel would be used to notice. The file scan is capped and says so
 * when it hits the cap — a truncated total presented as complete is worse than no
 * total at all.
 */
export function AnalyticsPanel() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<Analytics>("/api/admin/analytics")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-error">{error}</CardContent>
      </Card>
    );
  }
  if (!data) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="space-y-4">
      {data.truncated && (
        <p className="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Figures cover the {data.scannedFiles.toLocaleString()} most recent files; there are more.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Storage used" value={formatBytes(data.storage.usedBytes)} sub={`of ${formatBytes(data.storage.allocatedBytes)} allocated`} />
        <Stat label="Files" value={data.storage.fileCount.toLocaleString()} sub={`${data.storage.folderCount.toLocaleString()} folders`} />
        <Stat label="Accounts" value={data.users.total.toLocaleString()} sub={`${data.users.active} active · ${data.users.new7d} new this week`} />
        <Stat
          label="Revenue"
          value={money(data.payments.grossCents)}
          sub={`${money(data.payments.last30dCents)} in the last 30 days`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Storage by file type</CardTitle>
          </CardHeader>
          <CardContent>
            {data.storage.byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing stored yet.</p>
            ) : (
              <div className="space-y-2">
                {data.storage.byCategory.map((c) => {
                  const share = data.storage.usedBytes ? Math.round((c.bytes / data.storage.usedBytes) * 100) : 0;
                  return (
                    <div key={c.category} className="flex items-center gap-3">
                      <CategoryThumb category={c.category as FileCategory} className="h-8 w-8" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs font-medium capitalize text-foreground">{c.category}</span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {formatBytes(c.bytes)} · {c.count}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              {data.subscriptions.active} active · {data.subscriptions.pastDue} unpaid ·{" "}
              {data.subscriptions.cancelled} cancelled
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row label="Succeeded" value={data.payments.succeededCount} tone="success" />
            <Row label="Pending" value={data.payments.pendingCount} tone="muted" />
            <Row label="Failed" value={data.payments.failedCount} tone="error" />
            <Row label="Refunded" value={data.payments.refundedCount} tone="warning" />
            <p className="pt-1 text-xs text-muted-foreground">
              Revenue counts only payments that actually succeeded.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage by plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {data.storage.byPlan.map((p) => (
                <div key={p.planId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="capitalize text-foreground">{p.planId.replace("plan_", "")}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.accounts} account{p.accounts === 1 ? "" : "s"} · {formatBytes(p.bytes)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Heaviest accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No storage in use.</p>
            ) : (
              <div className="space-y-1.5">
                {data.topUsers.map((u) => (
                  <div key={u.userId} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/admin/users/${u.userId}`} className="truncate font-mono text-xs text-primary hover:underline">
                      {u.userId.slice(0, 8)}…
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(u.bytes)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: number; tone: "success" | "error" | "warning" | "muted" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-foreground">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}
