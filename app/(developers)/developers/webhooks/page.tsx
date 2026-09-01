"use client";

import { useState } from "react";
import { useWebhooks, useDeveloper } from "@/lib/hooks/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/lib/store/toast";
import { timeAgo } from "@/lib/utils";
import { Webhook as WebhookIcon, Plus, Trash2 } from "lucide-react";

const EVENTS = ["file.created", "file.updated", "file.deleted", "file.moved", "file.shared", "folder.created", "folder.deleted"];

export default function WebhooksPage() {
  const { data: webhooks, isLoading } = useWebhooks();
  const { createWebhook, updateWebhook, deleteWebhook } = useDeveloper();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string[]>(["file.created", "file.deleted"]);

  const toggleEvent = (e: string) => setSelected((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Webhooks</h1>
          <p className="mt-1 text-sm text-muted-foreground">Get notified asynchronously when events happen on your files.</p>
        </div>
        <Button onClick={() => { setUrl(""); setSelected(["file.created", "file.deleted"]); setOpen(true); }}>
          <Plus className="h-4 w-4" /> New endpoint
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <CardContent className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</CardContent>
        ) : (webhooks?.length ?? 0) === 0 ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <WebhookIcon className="mx-auto mb-3 h-8 w-8" /> No webhook endpoints configured.
          </CardContent>
        ) : (
          <div className="divide-y divide-border">
            {webhooks?.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><WebhookIcon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="truncate text-sm text-foreground">{w.url}</code>
                    <Badge tone={w.status === "active" ? "success" : "muted"}>{w.status}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.events.map((e) => <Badge key={e} tone="muted">{e}</Badge>)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last delivery: {w.lastDeliveryStatus ?? "—"} {w.lastDeliveredAt ? `· ${timeAgo(w.lastDeliveredAt)}` : ""} · Secret <code className="font-mono">{w.secret}</code>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateWebhook.mutate({ id: w.id, patch: { status: w.status === "active" ? "disabled" : "active" } })}
                  >
                    {w.status === "active" ? "Disable" : "Enable"}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Delete webhook" onClick={() => deleteWebhook.mutate(w.id, { onSuccess: () => toast.warning("Webhook deleted") })}>
                    <Trash2 className="h-4 w-4 text-error" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="New webhook endpoint" description="Receive signed POST events for your chosen triggers.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Endpoint URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/cloudcols" />
          </div>
          <div>
            <Label>Events</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EVENTS.map((e) => {
                const on = selected.includes(e);
                return (
                  <button key={e} onClick={() => toggleEvent(e)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-surface-2"}`}>
                    {e}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createWebhook.mutate({ url, events: selected }, {
                onSuccess: () => { toast.success("Webhook created"); setOpen(false); },
                onError: (e) => toast.error("Could not create webhook", (e as Error).message),
              })}
              loading={createWebhook.isPending}
            >
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
