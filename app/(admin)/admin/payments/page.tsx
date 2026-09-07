"use client";

import { useState } from "react";
import { useAdminPayments, useAdminUsers } from "@/lib/hooks/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function AdminPaymentsPage() {
  const { data: payments, isLoading } = useAdminPayments();
  const { data: users } = useAdminUsers();
  const [tab, setTab] = useState("transactions");
  const userMap = new Map((users ?? []).map((u) => [u.id, u.email]));
  // Only money that actually arrived. This used to sum every row — pending
  // checkouts that were never completed and failed charges included — so "Total
  // collected" reported revenue the business had not been paid.
  const rows = payments ?? [];
  const collected = rows.filter((p) => p.status === "succeeded").reduce((a, p) => a + p.amountCents, 0);
  const pending = rows.filter((p) => p.status === "pending").reduce((a, p) => a + p.amountCents, 0);
  const refunded = rows.filter((p) => p.status === "refunded").reduce((a, p) => a + p.amountCents, 0);
  const failedCount = rows.filter((p) => p.status === "failed").length;

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
            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-muted-foreground">
                Collected: <span className="font-semibold text-foreground">${(collected / 100).toFixed(2)}</span>
              </span>
              <span className="text-muted-foreground">
                Awaiting payment: <span className="font-medium text-foreground">${(pending / 100).toFixed(2)}</span>
              </span>
              <span className="text-muted-foreground">
                Refunded: <span className="font-medium text-foreground">${(refunded / 100).toFixed(2)}</span>
              </span>
              <span className="text-muted-foreground">
                Failed: <span className="font-medium text-foreground">{failedCount}</span>
              </span>
            </div>
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
            {/* This tab used to print a fixed list claiming Crypto was enabled. It is
                not — checkout refuses it with PROVIDER_UNAVAILABLE — and there was
                already a real screen for this. Pointing at it beats keeping a second
                one that disagrees. */}
            <p className="text-sm text-foreground">Provider keys and switches live on their own screen.</p>
            <p className="text-xs text-muted-foreground">
              Stripe is the only provider wired up. Crypto has an adapter slot and no adapter, and
              checkout refuses it rather than pretending.
            </p>
            <Link href="/admin/payment-gateways">
              <Button size="sm" variant="secondary">Open payment gateways</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
