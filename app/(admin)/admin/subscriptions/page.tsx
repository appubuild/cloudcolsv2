"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/api/adminClient";
import { formatDate } from "@/lib/utils";

/**
 * Subscriptions, from the subscriptions table.
 *
 * This screen used to read the browser's mock database, so it showed invented
 * subscriptions on a page whose only job is to say what customers are actually on.
 */

interface AdminSubscription {
  id: string;
  userId: string;
  userEmail: string;
  planId: string;
  planName: string;
  status: string;
  provider: string | null;
  startedAt: string;
  renewsAt: string | null;
  cancelledAt: string | null;
  currentPeriodEnd: string | null;
  hasProviderSubscription: boolean;
}

const TONE: Record<string, "success" | "warning" | "muted" | "error"> = {
  active: "success",
  past_due: "warning",
  cancelled: "muted",
  expired: "muted",
};

export default function AdminSubscriptionsPage() {
  const [rows, setRows] = useState<AdminSubscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    adminFetch<AdminSubscription[]>("/api/admin/subscriptions")
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Subscriptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">Active, past due, cancelled and expired subscriptions.</p>
      </div>

      {error && (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-foreground">Could not load subscriptions</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!rows && !error && (
        <Card><CardContent className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
      )}

      {rows && rows.length === 0 && !error && (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No subscriptions yet. One appears here when a customer starts a checkout.
            </p>
          </CardContent>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2">User</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Provider</th>
                  <th className="px-4 py-2">Status</th><th className="px-4 py-2">Renews</th><th className="px-4 py-2">Started</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 text-sm text-foreground">{s.userEmail || s.userId.slice(0, 8)}</td>
                    <td className="px-4 py-3"><Badge tone="info">{s.planName}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {s.provider ?? "—"}
                      {s.provider && !s.hasProviderSubscription && (
                        // Worth saying out loud: a row with a provider name but no
                        // provider subscription is not something anyone is billing for.
                        <span className="ml-2 text-xs text-muted-foreground">(not linked)</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><Badge tone={TONE[s.status] ?? "muted"}>{s.status.replace("_", " ")}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {s.renewsAt ? formatDate(s.renewsAt) : s.currentPeriodEnd ? `ends ${formatDate(s.currentPeriodEnd)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(s.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
