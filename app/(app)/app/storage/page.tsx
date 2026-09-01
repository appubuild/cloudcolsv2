"use client";

import Link from "next/link";
import { useMe, usePlans, useUsageSummary } from "@/lib/hooks/queries";
import { formatBytes } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { CategoryThumb } from "@/components/files/category-thumb";
import { CATEGORY_LABELS } from "@/data/seed";
import { Check, ArrowUpRight } from "lucide-react";

export default function StoragePage() {
  const { data: me } = useMe();
  const { data: plans } = usePlans();
  const { data: usage } = useUsageSummary();

  const plan = plans?.find((p) => p.id === me?.planId);
  const quotaPct = me ? (me.storageUsedBytes / me.storageQuotaBytes) * 100 : 0;
  const totalCatBytes = usage?.reduce((a, u) => a + u.bytes, 0) ?? 0;
  const onFreePlan = me?.planId === "plan_free";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Storage</h1>
        <p className="mt-1 text-sm text-muted-foreground">See what's using your space and manage your plan.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Current plan */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Current plan</CardTitle>
              <Badge tone={onFreePlan ? "muted" : "info"}>{plan?.name}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Storage used</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {formatBytes(me?.storageUsedBytes ?? 0)}
                <span className="ml-1 text-base font-normal text-muted-foreground">/ {formatBytes(me?.storageQuotaBytes ?? 0)}</span>
              </p>
            </div>
            <Progress value={quotaPct} />
            <p className="text-xs text-muted-foreground">{Math.max(0, Math.round(100 - quotaPct))}% remaining · {me?.storageUsedBytes ?? 0}/{me?.storageQuotaBytes ?? 0} bytes</p>
            {onFreePlan && (
              <Link href="/pricing" className="block">
                <Button className="w-full" variant="primary">
                  Upgrade to get more <ArrowUpRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Usage by category */}
        <Card>
          <CardHeader>
            <CardTitle>What's using space</CardTitle>
            <CardDescription>Breakdown by file type</CardDescription>
          </CardHeader>
          <CardContent>
            {usage ? (
              <div className="space-y-3">
                {usage.map((u) => {
                  const pct = totalCatBytes ? (u.bytes / totalCatBytes) * 100 : 0;
                  return (
                    <div key={u.category} className="flex items-center gap-3">
                      <CategoryThumb category={u.category} className="h-9 w-9" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">{CATEGORY_LABELS[u.category]}</span>
                          <span className="text-muted-foreground">{formatBytes(u.bytes)}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{u.count} file(s)</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Plan comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <CardDescription>All prices are configurable by your admin.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(plans ?? []).map((p) => {
              const active = p.id === me?.planId;
              return (
                <div
                  key={p.id}
                  className={`rounded-lg border p-4 ${active ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-foreground">{p.name}</p>
                    {active && <Badge tone="info">Current</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
                  <p className="mt-3 text-2xl font-bold text-foreground">
                    {p.priceCents === 0 ? "Free" : `$${(p.priceCents / 100).toFixed(2)}`}
                    {p.billingInterval && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                  </p>
                  <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
