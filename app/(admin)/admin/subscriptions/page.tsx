"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/misc";
import { usePlans, useAdminUsers } from "@/lib/hooks/queries";
import { getDb } from "@/lib/mock/db";
import { formatDate } from "@/lib/utils";

export default function AdminSubscriptionsPage() {
  const { data: plans } = usePlans();
  const { data: users } = useAdminUsers();
  const subs = getDb().subscriptions;
  const userMap = new Map((users ?? []).map((u) => [u.id, u.email]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Subscriptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">Active, cancelled and expired subscriptions.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-2">User</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">Status</th><th className="px-4 py-2">Renews</th><th className="px-4 py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 text-sm text-foreground">{userMap.get(s.userId) ?? s.userId}</td>
                  <td className="px-4 py-3"><Badge tone="info">{plans?.find((p) => p.id === s.planId)?.name ?? s.planId}</Badge></td>
                  <td className="px-4 py-3 text-muted-foreground">{s.provider ?? "—"}</td>
                  <td className="px-4 py-3"><Badge tone={s.status === "active" ? "success" : "warning"}>{s.status}</Badge></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{s.renewsAt ? formatDate(s.renewsAt) : "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(s.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
