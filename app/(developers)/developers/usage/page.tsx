"use client";

import { useState } from "react";
import { useApiUsage, useApiKeys, useApiPlans } from "@/lib/hooks/queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { timeAgo } from "@/lib/utils";

export default function UsagePage() {
  const [days, setDays] = useState("7");
  const { data: usage, isLoading } = useApiUsage(Number(days));
  const { data: keys } = useApiKeys();
  const { data: plans } = useApiPlans();
  const plan = plans?.find((p) => p.id === "api_pro");
  const items = usage?.items ?? [];
  const total = items.length;
  const ok = items.filter((r) => r.statusCode < 400).length;
  const rateLimited = items.filter((r) => r.statusCode === 429).length;

  const keyMap = new Map((keys ?? []).map((k) => [k.id, k.label]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">Request history and rate-limit status.</p>
        </div>
        <Tabs tabs={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }]} value={days} onChange={setDays} size="sm" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Total requests" value={total.toLocaleString()} />
        <Metric label="Success rate" value={total ? `${Math.round((ok / total) * 100)}%` : "—"} />
        <Metric label="Rate-limited" value={rateLimited.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request log</CardTitle>
          <CardDescription>Recent API activity</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No requests in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-2 pr-4">Time</th><th className="py-2 pr-4">Method</th><th className="py-2 pr-4">Endpoint</th>
                    <th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Latency</th><th className="py-2">Key</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 20).map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{timeAgo(r.createdAt)}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.method}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-foreground">{r.endpoint}</td>
                      <td className="py-2 pr-4">
                        <Badge tone={r.statusCode < 400 ? "success" : r.statusCode === 429 ? "warning" : "error"}>{r.statusCode}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{r.responseTimeMs}ms</td>
                      <td className="py-2 text-xs text-muted-foreground">{keyMap.get(r.apiKeyId) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Rate limits</CardTitle><CardDescription>Configured for your current plan</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Limit label="Requests / minute" value={plan ? String(plan.rateLimitPerMinute) : "—"} />
          <Limit label="Requests / month" value={plan ? plan.requestsPerMonth.toLocaleString() : "—"} />
          <Limit label="Used this period" value={total.toLocaleString()} />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold text-foreground">{value}</p></CardContent></Card>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}
