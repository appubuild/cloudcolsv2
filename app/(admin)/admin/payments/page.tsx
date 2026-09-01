"use client";

import { useState } from "react";
import { useAdminPayments, useAdminUsers } from "@/lib/hooks/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { toast } from "@/lib/store/toast";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export default function AdminPaymentsPage() {
  const { data: payments, isLoading } = useAdminPayments();
  const { data: users } = useAdminUsers();
  const [tab, setTab] = useState("transactions");
  const userMap = new Map((users ?? []).map((u) => [u.id, u.email]));
  const total = payments?.reduce((a, p) => a + p.amountCents, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">Transactions and payment provider configuration.</p>
      </div>
      <Tabs tabs={[{ id: "transactions", label: "Transactions" }, { id: "providers", label: "Payment Providers" }]} value={tab} onChange={setTab} />

      {tab === "transactions" && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm text-muted-foreground">Total collected: <span className="font-semibold text-foreground">${(total / 100).toFixed(2)}</span></p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-2 pr-4">User</th><th className="py-2 pr-4">Amount</th><th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Status</th><th className="py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={5}><Skeleton className="h-8" /></td></tr>)
                  ) : (
                    (payments ?? []).map((p) => (
                      <tr key={p.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-4 text-muted-foreground">{userMap.get(p.userId) ?? p.userId}</td>
                        <td className="py-2 pr-4 font-medium text-foreground">${(p.amountCents / 100).toFixed(2)}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{p.provider ?? "—"}</td>
                        <td className="py-2 pr-4"><Badge tone={p.status === "succeeded" ? "success" : p.status === "failed" ? "error" : "warning"}>{p.status}</Badge></td>
                        <td className="py-2 text-xs text-muted-foreground">{formatDate(p.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "providers" && (
        <Card>
          <CardContent className="space-y-3">
            {[
              { name: "Card (via adapter)", status: "enabled" },
              { name: "Crypto", status: "enabled" },
              { name: "Google Play Billing (mobile)", status: "disabled" },
            ].map((p) => (
              <div key={p.name} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{p.name}</span>
                <Badge tone={p.status === "enabled" ? "success" : "muted"}>{p.status}</Badge>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Payment provider wiring is adapter-based in production. This is a demonstration.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
