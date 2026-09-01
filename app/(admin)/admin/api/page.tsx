"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/store/toast";
import { getDb, saveDb } from "@/lib/mock/db";
import { timeAgo } from "@/lib/utils";

export default function AdminApiPage() {
  const [tab, setTab] = useState("plans");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Developer API</h1>
        <p className="mt-1 text-sm text-muted-foreground">API plans, keys, usage and webhooks.</p>
      </div>
      <Tabs
        tabs={[{ id: "plans", label: "API Plans" }, { id: "keys", label: "Keys" }, { id: "usage", label: "Usage" }, { id: "webhooks", label: "Webhooks" }]}
        value={tab}
        onChange={setTab}
      />
      {tab === "plans" && <ApiPlans />}
      {tab === "keys" && <ApiKeysTab />}
      {tab === "usage" && <ApiUsage />}
      {tab === "webhooks" && <WebhooksTab />}
    </div>
  );
}

function ApiPlans() {
  const plans = getDb().apiPlans;
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Requests/mo</th><th className="px-4 py-2">Rate/min</th><th className="px-4 py-2">Price</th><th className="px-4 py-2">Status</th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.requestsPerMonth.toLocaleString()}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.rateLimitPerMinute}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.priceCents === 0 ? "Free" : `$${(p.priceCents / 100).toFixed(2)}`}</td>
                <td className="px-4 py-3"><Badge tone={p.isActive ? "success" : "muted"}>{p.isActive ? "Active" : "Inactive"}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ApiKeysTab() {
  const keys = getDb().apiKeys;
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="px-4 py-2">Label</th><th className="px-4 py-2">Prefix</th><th className="px-4 py-2">Scopes</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Last used</th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium text-foreground">{k.label}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{k.keyPrefix}••••</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{k.scopes.join(", ")}</td>
                <td className="px-4 py-3"><Badge tone={k.status === "active" ? "success" : "muted"}>{k.status}</Badge></td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : "never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ApiUsage() {
  const logs = getDb().apiLogs;
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="px-4 py-2">Endpoint</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Latency</th><th className="px-4 py-2">When</th></tr></thead>
          <tbody>
            {logs.slice(0, 12).map((l) => (
              <tr key={l.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs text-foreground">{l.method} {l.endpoint}</td>
                <td className="px-4 py-2.5"><Badge tone={l.statusCode < 400 ? "success" : l.statusCode === 429 ? "warning" : "error"}>{l.statusCode}</Badge></td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{l.responseTimeMs}ms</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{timeAgo(l.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function WebhooksTab() {
  const hooks = getDb().webhooks;
  return (
    <Card>
      <CardContent className="space-y-2">
        {hooks.map((h) => (
          <div key={h.id} className="flex items-center justify-between">
            <div>
              <code className="text-sm text-foreground">{h.url}</code>
              <div className="mt-1 flex gap-1">{h.events.map((e) => <Badge key={e} tone="muted">{e}</Badge>)}</div>
            </div>
            <Badge tone={h.status === "active" ? "success" : "muted"}>{h.status}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
