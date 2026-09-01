"use client";

import { usePlans } from "@/lib/hooks/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/store/toast";
import { formatBytes } from "@/lib/utils";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { getDb, saveDb } from "@/lib/mock/db";
import { useRouter } from "next/navigation";

export default function AdminPlansPage() {
  const { data: plans } = usePlans();
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string; name: string; priceCents: number; quotaGb: number } | null>(null);

  const save = () => {
    if (!editing) return;
    const db = getDb();
    const plan = db.plans.find((p) => p.id === editing.id);
    if (plan) {
      plan.name = editing.name;
      plan.priceCents = editing.priceCents;
      plan.storageQuotaBytes = editing.quotaGb * 1024 * 1024 * 1024;
      saveDb();
    }
    toast.success("Plan updated", `${editing.name} saved.`);
    setEditing(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">Storage plans are configurable — no pricing is hard-coded.</p>
        </div>
        <Button onClick={() => toast.info("Add plan", "Editing plans is available in production.")}>Add plan</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-2">Plan</th><th className="px-4 py-2">Quota</th><th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Max file</th><th className="px-4 py-2">Ads</th><th className="px-4 py-2">API</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(plans ?? []).map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatBytes(p.storageQuotaBytes)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.priceCents === 0 ? "Free" : `$${(p.priceCents / 100).toFixed(2)}${p.billingInterval ? "/mo" : ""}`}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatBytes(p.maxFileSizeBytes)}</td>
                  <td className="px-4 py-3"><Badge tone={p.showsAds ? "warning" : "success"}>{p.showsAds ? "Yes" : "No"}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={p.apiIncluded ? "info" : "muted"}>{p.apiIncluded ? "Yes" : "No"}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={p.isActive ? "success" : "muted"}>{p.isActive ? "Active" : "Inactive"}</Badge></td>
                  <td className="px-4 py-3">
                    <Button variant="outline" size="sm" onClick={() => setEditing({ id: p.id, name: p.name, priceCents: p.priceCents, quotaGb: p.storageQuotaBytes / 1024 / 1024 / 1024 })}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {editing && (
        <Dialog open onClose={() => setEditing(null)} title="Edit plan">
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Price (cents)</Label><Input type="number" value={editing.priceCents} onChange={(e) => setEditing({ ...editing, priceCents: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label>Storage quota (GB)</Label><Input type="number" value={editing.quotaGb} onChange={(e) => setEditing({ ...editing, quotaGb: Number(e.target.value) })} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
