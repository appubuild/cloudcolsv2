"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/store/toast";
import { adminFetch } from "@/lib/api/adminClient";
import { formatBytes } from "@/lib/utils";

/**
 * System settings.
 *
 * These were environment variables — TRASH_RETENTION_DAYS, INACTIVITY_DAYS and the
 * rest — so changing one meant a deploy, and on Workers reading one through
 * process.env did not see the binding anyway, meaning several of them had never had
 * any effect at all. They are rows now, and this screen writes them.
 *
 * Ads have their own screen because they have more shape than a single value.
 * Everything else that is a number or a switch is here.
 */

interface SettingRow {
  key: string;
  value: unknown;
  description: string;
  isPublic: boolean;
  type: string;
}

/** Rendered here; anything else on the server is edited elsewhere or not at all. */
const SHOWN: { key: string; label: string; unit?: string; group: string }[] = [
  { key: "registration_enabled", label: "Allow new registrations", group: "Access" },
  { key: "maintenance_mode", label: "Maintenance mode", group: "Access" },
  { key: "max_file_size_bytes", label: "Maximum file size", unit: "bytes", group: "Uploads" },
  { key: "upload_url_ttl_seconds", label: "Upload URL lifetime", unit: "seconds", group: "Uploads" },
  { key: "signed_url_ttl_seconds", label: "Download URL lifetime", unit: "seconds", group: "Uploads" },
  { key: "trash_retention_days", label: "Trash retention", unit: "days", group: "Trash" },
  { key: "trash_counts_toward_quota", label: "Trashed files count toward quota", group: "Trash" },
  { key: "inactivity_warn_days", label: "First warning after", unit: "days", group: "Inactivity" },
  { key: "inactivity_final_warn_days", label: "Final warning after", unit: "days", group: "Inactivity" },
  { key: "inactivity_grace_days", label: "Scheduled for deletion after", unit: "days", group: "Inactivity" },
];

const GROUPS = ["Access", "Uploads", "Trash", "Inactivity"];

export default function AdminSettingsPage() {
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    adminFetch<SettingRow[]>("/api/admin/settings")
      .then((data) => {
        setRows(data);
        setDraft(Object.fromEntries(data.map((r) => [r.key, r.value])));
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const dirty = rows
    ? Object.entries(draft).filter(([k, v]) => {
        const original = rows.find((r) => r.key === k)?.value;
        return JSON.stringify(original) !== JSON.stringify(v);
      })
    : [];

  const save = async () => {
    if (dirty.length === 0) return;
    setSaving(true);
    try {
      const res = await adminFetch<{ applied: string[]; rejected: { key: string; reason: string }[] }>(
        "/api/admin/settings",
        { method: "PATCH", body: JSON.stringify({ settings: Object.fromEntries(dirty) }) },
      );
      if (res.rejected.length > 0) {
        toast.error(
          `${res.rejected.length} setting${res.rejected.length === 1 ? "" : "s"} refused`,
          res.rejected.map((r) => `${r.key}: ${r.reason}`).join(" · "),
        );
      }
      if (res.applied.length > 0) {
        toast.success(`${res.applied.length} setting${res.applied.length === 1 ? "" : "s"} saved`);
      }
      load();
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inMaintenance = Boolean(draft.maintenance_mode);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Business rules the server reads directly. Changes take effect within a minute, with no deploy.
          </p>
        </div>
        <Button onClick={save} disabled={saving || dirty.length === 0}>
          {saving ? "Saving…" : dirty.length > 0 ? `Save ${dirty.length} change${dirty.length === 1 ? "" : "s"}` : "Saved"}
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-foreground">Could not load settings</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!rows && !error && (
        <Card><CardContent className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</CardContent></Card>
      )}

      {inMaintenance && (
        <Card>
          <CardContent>
            <p className="text-sm text-foreground">
              <Badge tone="warning" className="mr-2">Maintenance</Badge>
              Signed-in users can read their files but cannot upload, rename, delete or share.
              Admin access and incoming payment webhooks are unaffected.
            </p>
          </CardContent>
        </Card>
      )}

      {rows &&
        GROUPS.map((group) => {
          const items = SHOWN.filter((s) => s.group === group && rows.some((r) => r.key === s.key));
          if (items.length === 0) return null;
          return (
            <Card key={group}>
              <CardContent className="space-y-4">
                <p className="text-sm font-medium text-foreground">{group}</p>
                {items.map((item) => {
                  const row = rows.find((r) => r.key === item.key)!;
                  const value = draft[item.key];
                  return (
                    <div key={item.key} className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{row.description}</p>
                        {item.key === "max_file_size_bytes" && typeof value === "number" && (
                          <p className="mt-0.5 text-xs text-muted-foreground">= {formatBytes(value)}</p>
                        )}
                      </div>
                      <div className="shrink-0">
                        {typeof row.value === "boolean" ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(value)}
                            aria-label={item.label}
                            onClick={() => setDraft({ ...draft, [item.key]: !value })}
                            className={`h-5 w-9 rounded-full p-0.5 transition-colors ${value ? "bg-primary" : "bg-border"}`}
                          >
                            <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${value ? "translate-x-4" : ""}`} />
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              aria-label={item.label}
                              className="w-40"
                              value={String(value ?? "")}
                              onChange={(e) => setDraft({ ...draft, [item.key]: Number(e.target.value) })}
                            />
                            {item.unit && <span className="text-xs text-muted-foreground">{item.unit}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}
