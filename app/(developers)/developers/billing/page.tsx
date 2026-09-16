"use client";

import { useEffect, useState } from "react";
import { useApiPlans } from "@/lib/hooks/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";
import { apiClient } from "@/lib/api/client";
import { Check } from "lucide-react";

interface AccountPlan {
  planId: string;
  planName: string;
  requestsPerMonth: number;
  requestsThisMonth: number;
  activeKeys: number;
}

/**
 * The account's Developer API plan.
 *
 * The current plan used to be a constant — every visitor was told they were on
 * "api_pro" — beside a "Switch to X" button that, when pressed, admitted billing was
 * simulated. It now reads the account's real plan and its usage, moves between free
 * plans for real, and says plainly that a paid plan is arranged with us.
 */
export default function DeveloperBilling() {
  const { data: plans } = useApiPlans();
  const [account, setAccount] = useState<AccountPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    apiClient
      .get<AccountPlan>("/api/dev/plan")
      .then(setAccount)
      .catch(() => setAccount(null));

  useEffect(() => {
    void load();
  }, []);

  const switchTo = async (planId: string) => {
    setBusy(planId);
    try {
      await apiClient.post("/api/dev/plan", { planId });
      await load();
      toast.success("Plan changed");
    } catch (e) {
      toast.error("Could not change plan", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Developer Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The Developer API is billed separately from your storage plan.
        </p>
      </div>

      {account && (
        <Card>
          <CardHeader><CardTitle>This month</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{account.planName}</span> ·{" "}
            {account.requestsThisMonth.toLocaleString()} of {account.requestsPerMonth.toLocaleString()} requests used ·{" "}
            {account.activeKeys} active key{account.activeKeys === 1 ? "" : "s"}.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {(plans ?? []).filter((p) => p.isActive).map((p) => {
          const current = p.id === account?.planId;
          const paid = p.priceCents > 0;
          return (
            <Card key={p.id} className={current ? "border-primary" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{p.name}</CardTitle>
                  {current && <Badge tone="info">Current</Badge>}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col">
                <p className="text-2xl font-bold text-foreground">
                  {p.priceCents === 0 ? "Free" : `$${(p.priceCents / 100).toFixed(2)}`}
                  {p.priceCents > 0 && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /> {p.requestsPerMonth.toLocaleString()} requests/mo</li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /> {p.rateLimitPerMinute} req/min</li>
                </ul>
                {!current &&
                  (paid ? (
                    // Honest: a paid plan is granted by a confirmed payment or by us,
                    // never by the account asking for it.
                    <p className="mt-5 text-xs text-muted-foreground">
                      Contact support to move to this plan. Self-serve upgrades are not available yet.
                    </p>
                  ) : (
                    <Button
                      variant="secondary"
                      className="mt-5"
                      loading={busy === p.id}
                      onClick={() => void switchTo(p.id)}
                    >
                      Switch to {p.name}
                    </Button>
                  ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Free plans are not invoiced. Invoices for a paid Developer plan come from your payment provider.
        </CardContent>
      </Card>
    </div>
  );
}
