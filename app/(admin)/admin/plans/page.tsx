"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/lib/store/toast";
import { formatBytes } from "@/lib/utils";
import { adminFetch } from "@/lib/api/adminClient";
import type { Plan } from "@/lib/types";

/**
 * The plan catalogue, as an admin edits it.
 *
 * This screen used to write to a mock database in the browser's own storage and
 * report success. Nothing left the page, and the prices the product charged lived
 * in four hardcoded copies in the server that no screen could reach. It now reads
 * and writes /api/admin/plans, which is the same `plans` table that checkout, the
 * quota check, the pricing page and the Stripe webhook all read.
 */

const GIB = 1024 * 1024 * 1024;

interface Draft {
  id: string;
  name: string;
  tagline: string;
  priceCents: number;
  quotaGb: number;
  maxFileGb: number;
  billingInterval: "monthly" | "yearly" | null;
  showsAds: boolean;
  apiIncluded: boolean;
  isActive: boolean;
}

function toDraft(p: Plan): Draft {
  return {
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    priceCents: p.priceCents,
    quotaGb: p.storageQuotaBytes / GIB,
    maxFileGb: p.maxFileSizeBytes / GIB,
    billingInterval: (p.billingInterval as Draft["billingInterval"]) ?? null,
    showsAds: p.showsAds,
    apiIncluded: p.apiIncluded,
    isActive: p.isActive,
  };
}

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    adminFetch<Plan[]>("/api/admin/plans")
      .then((rows) => {
        setPlans(rows);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const saved = await adminFetch<Plan & { accountsUpdated?: number }>("/api/admin/plans", {
        method: "PATCH",
        body: JSON.stringify({
          id: editing.id,
          name: editing.name,
          tagline: editing.tagline,
          priceCents: editing.priceCents,
          // Sent as bytes. The form works in GB because that is how people think
          // about storage; the server stores and enforces bytes.
          storageQuotaBytes: Math.round(editing.quotaGb * GIB),
          maxFileSizeBytes: Math.round(editing.maxFileGb * GIB),
          billingInterval: editing.priceCents === 0 ? null : (editing.billingInterval ?? "monthly"),
          showsAds: editing.showsAds,
          apiIncluded: editing.apiIncluded,
          isActive: editing.isActive,
        }),
      });

      const moved = saved.accountsUpdated ?? 0;
      toast.success(
        "Plan saved",
        moved > 0
          ? `${saved.name} updated. ${moved} account${moved === 1 ? "" : "s"} moved to the new quota.`
          : `${saved.name} updated.`,
      );
      setEditing(null);
      load();
    } catch (e) {
      toast.error("Could not save the plan", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What every plan costs and grants. Checkout, quotas and the pricing page all read these.
          </p>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-foreground">Could not load plans</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!plans && !error && (
        <Card><CardContent className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
      )}

      {plans && plans.length === 0 && !error && (
        <Card><CardContent><p className="text-sm text-muted-foreground">No plans are configured.</p></CardContent></Card>
      )}

      {plans && plans.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2">Plan</th><th className="px-4 py-2">Quota</th><th className="px-4 py-2">Price</th>
                  <th className="px-4 py-2">Max file</th><th className="px-4 py-2">Ads</th><th className="px-4 py-2">API</th>
                  <th className="px-4 py-2">Status</th><th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatBytes(p.storageQuotaBytes)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.priceCents === 0 ? "Free" : `$${(p.priceCents / 100).toFixed(2)}${p.billingInterval === "yearly" ? "/yr" : "/mo"}`}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatBytes(p.maxFileSizeBytes)}</td>
                    <td className="px-4 py-3"><Badge tone={p.showsAds ? "warning" : "success"}>{p.showsAds ? "Yes" : "No"}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={p.apiIncluded ? "info" : "muted"}>{p.apiIncluded ? "Yes" : "No"}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={p.isActive ? "success" : "muted"}>{p.isActive ? "Active" : "Retired"}</Badge></td>
                    <td className="px-4 py-3">
                      <Button variant="outline" size="sm" onClick={() => setEditing(toDraft(p))}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {editing && (
        <Dialog open onClose={() => (saving ? undefined : setEditing(null))} title={`Edit ${editing.name}`}>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Name</Label>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="space-y-1.5"><Label>Tagline</Label>
              <Input value={editing.tagline} onChange={(e) => setEditing({ ...editing, tagline: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Price (cents)</Label>
                <Input type="number" min={0} value={editing.priceCents}
                  onChange={(e) => setEditing({ ...editing, priceCents: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5"><Label>Billing</Label>
                <select
                  className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground"
                  value={editing.priceCents === 0 ? "none" : (editing.billingInterval ?? "monthly")}
                  disabled={editing.priceCents === 0}
                  onChange={(e) => setEditing({ ...editing, billingInterval: e.target.value as Draft["billingInterval"] })}
                >
                  {editing.priceCents === 0 ? <option value="none">Free — no billing</option> : null}
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Storage quota (GB)</Label>
                <Input type="number" min={1} value={editing.quotaGb}
                  onChange={(e) => setEditing({ ...editing, quotaGb: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5"><Label>Max file size (GB)</Label>
                <Input type="number" min={1} step="0.5" value={editing.maxFileGb}
                  onChange={(e) => setEditing({ ...editing, maxFileGb: Number(e.target.value) })} />
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <Toggle label="Show ads on this plan" value={editing.showsAds} onChange={(v) => setEditing({ ...editing, showsAds: v })} />
              <Toggle label="Developer API included" value={editing.apiIncluded} onChange={(v) => setEditing({ ...editing, apiIncluded: v })} />
              <Toggle label="Offered to new customers" value={editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} />
            </div>

            <p className="text-xs text-muted-foreground">
              Changing the quota also moves accounts on this plan that are still on its current
              allowance. Accounts given a custom amount are left alone.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex w-full items-center justify-between gap-4 text-left">
      <span className="text-sm text-foreground">{label}</span>
      <span
        aria-hidden
        className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${value ? "bg-primary" : "bg-border"}`}
      >
        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${value ? "translate-x-4" : ""}`} />
      </span>
      <span className="sr-only">{value ? "on" : "off"}</span>
    </button>
  );
}
