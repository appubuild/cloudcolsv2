"use client";

import { useEffect, useState } from "react";
import { useAdminStats, useAdminUsers, useAdminPayments } from "@/lib/hooks/queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { formatBytes } from "@/lib/utils";
import { Users, HardDrive, CreditCard, Activity, UserPlus, DollarSign } from "lucide-react";
import { AnalyticsPanel } from "@/components/admin/analytics-panel";

export default function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();
  const { data: users } = useAdminUsers();
  const { data: payments } = useAdminPayments();

  const mrr = stats?.mrrCents ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Operational snapshot of the CloudCols platform.</p>
      </div>

      {/* Everything below is derived from the rows rather than from counters, so a
          figure that has drifted shows up here rather than being repeated. */}
      <AnalyticsPanel />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Widget icon={<Users className="h-5 w-5" />} label="Total users" value={isLoading ? "…" : String(stats?.totalUsers ?? 0)} sub={`${stats?.activeUsers ?? 0} active`} />
        <Widget icon={<UserPlus className="h-5 w-5" />} label="New signups (7d)" value={isLoading ? "…" : String(stats?.newSignups7d ?? 0)} />
        <Widget icon={<HardDrive className="h-5 w-5" />} label="Storage used" value={isLoading ? "…" : formatBytes(stats?.storageUsedBytes ?? 0)} sub={`${stats?.totalFiles ?? 0} files`} />
        <Widget icon={<DollarSign className="h-5 w-5" />} label="MRR" value={isLoading ? "…" : `$${(mrr / 100).toFixed(2)}`} sub={`${stats?.activeSubscriptions ?? 0} subscriptions`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SystemHealth apiRequests7d={stats?.apiRequests7d ?? 0} />

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Recent users</CardTitle><CardDescription>Latest registered accounts</CardDescription></CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {(users ?? []).slice(0, 5).map((u) => (
                <div key={u.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {u.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={u.planId === "plan_free" ? "muted" : "info"}>{u.planId.replace("plan_", "")}</Badge>
                    <Badge tone={u.status === "active" ? "success" : "warning"}>{u.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent payments</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4">Amount</th><th className="py-2 pr-4">Provider</th><th className="py-2 pr-4">Status</th><th className="py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {(payments ?? []).slice(0, 6).map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-4 font-medium text-foreground">${(p.amountCents / 100).toFixed(2)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{p.provider ?? "—"}</td>
                    <td className="py-2 pr-4"><Badge tone={p.status === "succeeded" ? "success" : p.status === "failed" ? "error" : "warning"}>{p.status}</Badge></td>
                    <td className="py-2 text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Widget({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-muted-foreground"><span>{icon}</span><span className="text-xs">{label}</span></div>
        <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

interface Health {
  ok: boolean;
  build: string;
  dataLayer: { server: string; builtWith: string | null };
  providers: { supabase: boolean; b2: boolean };
  warnings?: string[];
}

/**
 * What the server actually reports, from /api/health.
 *
 * This panel used to be a hardcoded array: "Object storage (B2): ok", "API: ok",
 * "CDN: ok", "Database: ok" — four green badges that were green because they were
 * written that way. A dashboard that says everything is fine regardless is worse
 * than one with no health panel, because someone will believe it.
 *
 * CDN is gone from the list rather than reported: nothing here can see it, and the
 * CDN is not wired up yet anyway.
 */
function SystemHealth({ apiRequests7d }: { apiRequests7d: number }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  return (
    <Card className="lg:col-span-1">
      <CardHeader>
        <CardTitle>System health</CardTitle>
        {health && <CardDescription className="font-mono text-xs">build {health.build}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {failed && <p className="text-sm text-error">The API did not answer.</p>}
        {!health && !failed && <Skeleton className="h-20 w-full" />}
        {health && (
          <>
            <Line label="Database (Supabase)" ok={health.providers.supabase} />
            <Line label="Object storage (B2)" ok={health.providers.b2} />
            <Line label="Data layer" ok={health.dataLayer.server !== "mock"} text={health.dataLayer.server} />
            {(health.warnings ?? []).map((w) => (
              <p key={w} className="rounded-md bg-warning/10 p-2 text-xs text-warning">{w}</p>
            ))}
          </>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-muted-foreground">API requests (7d)</span>
          <span className="text-sm font-medium text-foreground tabular-nums">{apiRequests7d}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Line({ label, ok, text }: { label: string; ok: boolean; text?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Badge tone={ok ? "success" : "error"}>{text ?? (ok ? "ok" : "not configured")}</Badge>
    </div>
  );
}
