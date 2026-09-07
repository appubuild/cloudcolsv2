"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/api/adminClient";
import { timeAgo } from "@/lib/utils";

/**
 * The Developer API across all accounts.
 *
 * Every tab on this screen used to read the browser's mock database — invented API
 * keys, invented request logs, invented webhooks — on a page whose entire job is to
 * tell an operator what is really happening. It now reads /api/admin/developer.
 *
 * Note what an empty Usage tab means here: nothing writes api_request_logs yet,
 * because the public /v1 surface those keys are for has not been built. The tab
 * says so rather than looking merely quiet.
 */

interface DeveloperOverview {
  plans: { id: string; name: string; requestsPerMonth: number; rateLimitPerMinute: number; priceCents: number; isActive: boolean }[];
  keys: { id: string; owner: string; keyPrefix: string; label: string; scopes: string[]; status: string; createdAt: string; lastUsedAt: string | null }[];
  logs: { id: string; owner: string; endpoint: string; method: string; statusCode: number; responseTimeMs: number; createdAt: string }[];
  webhooks: { id: string; owner: string; url: string; events: string[]; status: string; lastDeliveryStatus: string | null; lastDeliveredAt: string | null }[];
}

export default function AdminApiPage() {
  const [tab, setTab] = useState("plans");
  const [data, setData] = useState<DeveloperOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    adminFetch<DeveloperOverview>("/api/admin/developer")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Developer API</h1>
        <p className="mt-1 text-sm text-muted-foreground">API plans, keys, usage and webhooks, across every account.</p>
      </div>
      <Tabs
        tabs={[{ id: "plans", label: "API Plans" }, { id: "keys", label: "Keys" }, { id: "usage", label: "Usage" }, { id: "webhooks", label: "Webhooks" }]}
        value={tab}
        onChange={setTab}
      />

      {error && (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-foreground">Could not load</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!data && !error && (
        <Card><CardContent className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</CardContent></Card>
      )}

      {data && tab === "plans" && (
        <Table
          head={["Plan", "Requests/mo", "Rate/min", "Price", "Status"]}
          empty="No API plans are configured."
          rows={data.plans.map((p) => [
            <span key="n" className="font-medium text-foreground">{p.name}</span>,
            p.requestsPerMonth.toLocaleString(),
            String(p.rateLimitPerMinute),
            p.priceCents === 0 ? "Free" : `$${(p.priceCents / 100).toFixed(2)}`,
            <Badge key="s" tone={p.isActive ? "success" : "muted"}>{p.isActive ? "Active" : "Inactive"}</Badge>,
          ])}
        />
      )}

      {data && tab === "keys" && (
        <Table
          head={["Label", "Owner", "Prefix", "Scopes", "Status", "Last used"]}
          empty="No API keys have been created."
          rows={data.keys.map((k) => [
            <span key="l" className="font-medium text-foreground">{k.label}</span>,
            <span key="o" className="text-xs">{k.owner}</span>,
            <code key="p" className="font-mono text-xs text-muted-foreground">{k.keyPrefix}••••</code>,
            <span key="sc" className="text-xs">{k.scopes.join(", ")}</span>,
            <Badge key="st" tone={k.status === "active" ? "success" : "muted"}>{k.status}</Badge>,
            k.lastUsedAt ? timeAgo(k.lastUsedAt) : "never",
          ])}
        />
      )}

      {data && tab === "usage" && (
        <>
          {data.logs.length === 0 && (
            <Card>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  No API requests recorded. Requests are logged when the public <code className="font-mono text-xs">/v1</code>{" "}
                  surface serves them, and that surface has not been built yet — so this stays empty
                  until it is, however many keys exist.
                </p>
              </CardContent>
            </Card>
          )}
          {data.logs.length > 0 && (
            <Table
              head={["Endpoint", "Owner", "Status", "Latency", "When"]}
              empty=""
              rows={data.logs.map((l) => [
                <code key="e" className="font-mono text-xs text-foreground">{l.method} {l.endpoint}</code>,
                <span key="o" className="text-xs">{l.owner}</span>,
                <Badge key="s" tone={l.statusCode < 400 ? "success" : l.statusCode === 429 ? "warning" : "error"}>{l.statusCode}</Badge>,
                `${l.responseTimeMs}ms`,
                timeAgo(l.createdAt),
              ])}
            />
          )}
        </>
      )}

      {data && tab === "webhooks" && (
        <Card>
          <CardContent className="space-y-3">
            {data.webhooks.length === 0 && <p className="text-sm text-muted-foreground">No webhooks are registered.</p>}
            {data.webhooks.map((h) => (
              <div key={h.id} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <code className="block truncate text-sm text-foreground">{h.url}</code>
                  <p className="text-xs text-muted-foreground">{h.owner}</p>
                  <div className="mt-1 flex flex-wrap gap-1">{h.events.map((e) => <Badge key={e} tone="muted">{e}</Badge>)}</div>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone={h.status === "active" ? "success" : "muted"}>{h.status}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {h.lastDeliveredAt ? `${h.lastDeliveryStatus ?? "sent"} · ${timeAgo(h.lastDeliveredAt)}` : "never delivered"}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) {
    return <Card><CardContent><p className="text-sm text-muted-foreground">{empty}</p></CardContent></Card>;
  }
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              {head.map((h) => <th key={h} className="px-4 py-2">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                {cells.map((c, j) => <td key={j} className="px-4 py-3 text-muted-foreground">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
