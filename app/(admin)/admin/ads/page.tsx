"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/store/toast";

export default function AdminAdsPage() {
  const [adsEnabled, setAdsEnabled] = useState(true);
  const [placements, setPlacements] = useState<Record<string, boolean>>({
    sidebar: true,
    storage_page: true,
    preview_bottom: false,
    onboarding: false,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ads are shown only to Free-plan users and never interfere with uploads, downloads, or core navigation.
        </p>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Ads system</p>
            <p className="text-xs text-muted-foreground">Master toggle</p>
          </div>
          <Badge tone={adsEnabled ? "success" : "muted"}>{adsEnabled ? "Enabled" : "Disabled"}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium text-foreground">Placements</p>
          {Object.entries(placements).map(([key, on]) => (
            <ToggleRow key={key} title={key.replace(/_/g, " ")} desc={key === "preview_bottom" ? "A small banner below previews (never on media controls)." : ""} value={on} onChange={() => setPlacements((p) => ({ ...p, [key]: !p[key] }))} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium text-foreground">Provider config</p>
          <div className="space-y-1.5"><p className="text-xs text-muted-foreground">Provider ID</p><input placeholder="e.g. ad_net_12345" className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm" /></div>
          <Button size="sm" variant="secondary" onClick={() => toast.success("Ad config saved")}>Save ad config</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleRow({ title, desc, value, onChange }: { title: string; desc: string; value: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className="flex w-full items-center justify-between gap-4 text-left">
      <div><p className="text-sm font-medium text-foreground">{title}</p>{desc && <p className="text-xs text-muted-foreground">{desc}</p>}</div>
      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${value ? "bg-primary" : "bg-surface-2"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${value ? "translate-x-6" : "translate-x-1"}`} />
      </span>
    </button>
  );
}
