"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/lib/store/toast";
import { adminFetch } from "@/lib/api/adminClient";

/**
 * Ads configuration.
 *
 * This screen was entirely useState: toggling a placement changed a variable in the
 * browser, "Save ad config" showed a success toast, and nothing was written or read
 * anywhere. It now reads and writes system_settings, and components/ads/ad-slot.tsx
 * reads the same values.
 *
 * Which plans see ads is not here — that is a property of a plan, on the Plans
 * screen. Two places to decide the same thing is how the plan catalogue ended up in
 * five copies.
 */

interface AdsConfig {
  providerId: string;
  placements: Record<string, boolean>;
}

interface SettingRow {
  key: string;
  value: unknown;
  description: string;
}

/**
 * The placements the app actually has a slot for. A toggle for a placement nothing
 * renders would be another control that does nothing.
 *
 * Nothing appears during upload, download or preview: the product rules say ads
 * must never interfere with those.
 */
const PLACEMENTS: { id: string; label: string; desc: string }[] = [
  { id: "sidebar", label: "Sidebar", desc: "Below the storage meter in the app sidebar." },
  { id: "storage_page", label: "Storage page", desc: "Under the plan comparison on the Storage screen." },
];

export default function AdminAdsPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [config, setConfig] = useState<AdsConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    adminFetch<SettingRow[]>("/api/admin/settings")
      .then((rows) => {
        const on = rows.find((r) => r.key === "ads_enabled")?.value;
        const cfg = rows.find((r) => r.key === "ads_config")?.value as AdsConfig | undefined;
        setEnabled(Boolean(on));
        setConfig({ providerId: cfg?.providerId ?? "", placements: cfg?.placements ?? {} });
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const save = async () => {
    if (config === null || enabled === null) return;
    setSaving(true);
    try {
      const res = await adminFetch<{ applied: string[]; rejected: { key: string; reason: string }[] }>(
        "/api/admin/settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            settings: {
              ads_enabled: enabled,
              ads_config: { providerId: config.providerId.trim(), placements: config.placements },
            },
          }),
        },
      );
      if (res.rejected.length > 0) {
        toast.error("Some settings were refused", res.rejected.map((r) => `${r.key}: ${r.reason}`).join(" · "));
      } else {
        toast.success("Ads configuration saved");
      }
      load();
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const togglePlacement = (id: string) => {
    if (!config) return;
    setConfig({ ...config, placements: { ...config.placements, [id]: !config.placements[id] } });
  };

  const live = Boolean(enabled) && Boolean(config?.providerId.trim());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ads show only on plans marked ad-supported, and never during upload, download or preview.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-foreground">Could not load</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {(enabled === null || config === null) && !error && (
        <Card><CardContent className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
      )}

      {enabled !== null && config !== null && (
        <>
          <Card>
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Ads system</p>
                <p className="text-xs text-muted-foreground">Master switch, across every placement</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={live ? "success" : "muted"}>{live ? "Live" : enabled ? "No provider" : "Off"}</Badge>
                <Toggle value={enabled} onChange={setEnabled} label="Ads system" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <p className="text-sm font-medium text-foreground">Provider</p>
              <div className="space-y-1.5">
                <Label htmlFor="provider">Provider ID</Label>
                <Input
                  id="provider"
                  value={config.providerId}
                  onChange={(e) => setConfig({ ...config, providerId: e.target.value })}
                  placeholder="e.g. ca-pub-1234567890"
                />
                <p className="text-xs text-muted-foreground">
                  Nothing is shown to anyone until this is set — a placement with no provider
                  renders nothing rather than an empty box.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <p className="text-sm font-medium text-foreground">Placements</p>
              {PLACEMENTS.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.label}</p>
                    <p className="text-xs text-muted-foreground">{p.desc}</p>
                  </div>
                  <Toggle value={Boolean(config.placements[p.id])} onChange={() => togglePlacement(p.id)} label={p.label} />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save ad configuration"}</Button>
          </div>
        </>
      )}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${value ? "bg-primary" : "bg-border"}`}
    >
      <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${value ? "translate-x-4" : ""}`} />
    </button>
  );
}
