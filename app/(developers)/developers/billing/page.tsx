"use client";

import { useApiPlans, useMe } from "@/lib/hooks/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";
import { Check } from "lucide-react";

export default function DeveloperBilling() {
  const { data: plans } = useApiPlans();
  const { data: me } = useMe();
  const active = "api_pro";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Developer Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The Developer API is billed separately from your storage plan.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {(plans ?? []).filter((p) => p.isActive).map((p) => {
          const current = p.id === active;
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
                {!current && (
                  <Button variant="secondary" className="mt-5" onClick={() => toast.info("Billing is mocked", "Upgrade flows are simulated in this demo.")}>
                    Switch to {p.name}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No invoices for the current cycle. In production these come from your payment provider.
        </CardContent>
      </Card>
    </div>
  );
}
