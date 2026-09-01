"use client";

import Link from "next/link";
import { useMe, useApiUsage, useApiKeys, useApiPlans, useWebhooks } from "@/lib/hooks/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import { Activity, KeyRound, Webhook as WebhookIcon, Zap } from "lucide-react";

export default function DeveloperDashboard() {
  const { data: me } = useMe();
  const { data: usage } = useApiUsage(30);
  const { data: keys } = useApiKeys();
  const { data: apiPlans } = useApiPlans();
  const { data: webhooks } = useWebhooks();

  const plan = apiPlans?.find((p) => p.id === "api_pro");
  const requests = usage?.items ?? [];
  const total = requests.length;
  const ok = requests.filter((r) => r.statusCode < 400).length;
  const fail = total - ok;
  const fourxx = requests.filter((r) => r.statusCode >= 400 && r.statusCode < 500).length;
  const fivexx = requests.filter((r) => r.statusCode >= 500).length;
  const rateLimited = requests.filter((r) => r.statusCode === 429).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Developer Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Monitor your API usage, keys and plan.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Activity className="h-5 w-5" />} label="Requests (30d)" value={total.toLocaleString()} />
        <Stat icon={<Zap className="h-5 w-5" />} label="Success rate" value={total ? `${Math.round((ok / total) * 100)}%` : "—"} />
        <Stat icon={<KeyRound className="h-5 w-5" />} label="Active keys" value={String(keys?.filter((k) => k.status === "active").length ?? 0)} />
        <Stat icon={<WebhookIcon className="h-5 w-5" />} label="Webhooks" value={String(webhooks?.length ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request breakdown</CardTitle>
            <CardDescription>From the last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Successful (2xx/3xx)", value: ok, color: "bg-success" },
              { label: "4xx errors", value: fourxx, color: "bg-warning" },
              { label: "5xx errors", value: fivexx, color: "bg-error" },
              { label: "Rate-limited (429)", value: rateLimited, color: "bg-error" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className={`h-2.5 w-2.5 rounded-full ${row.color}`} /> {row.label}
                </span>
                <span className="font-medium text-foreground">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan & quota</CardTitle>
            <CardDescription>Current developer plan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge tone="info">{plan?.name ?? "Developer Free"}</Badge>
              <span className="text-sm text-muted-foreground">
                {plan ? `${plan.requestsPerMonth.toLocaleString()} req/mo` : ""}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{total.toLocaleString()}</span> requests used this month.
            </p>
            <Link href="/developers/billing"><Button variant="secondary" size="sm">Manage plan</Button></Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{icon}</span>
          <span className="text-xs">{label}</span>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
