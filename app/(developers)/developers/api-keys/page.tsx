"use client";

import { useState } from "react";
import { useApiKeys, useDeveloper } from "@/lib/hooks/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/lib/store/toast";
import { timeAgo } from "@/lib/utils";
import { KeyRound, Plus, Copy, Trash2, ShieldCheck } from "lucide-react";

const AVAILABLE_SCOPES = ["files.read", "files.write", "files.delete", "folders.read", "folders.write", "share.create", "webhook.manage"];

export default function ApiKeysPage() {
  const { data: keys, isLoading } = useApiKeys();
  const { createKey, revokeKey } = useDeveloper();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>(["files.read", "files.write"]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const toggleScope = (s: string) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">API Keys</h1>
          <p className="mt-1 text-sm text-muted-foreground">Credentials that let your apps talk to the CloudCols API.</p>
        </div>
        <Button onClick={() => { setLabel(""); setScopes(["files.read", "files.write"]); setCreatedSecret(null); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Create key
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <CardContent className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </CardContent>
        ) : (keys?.length ?? 0) === 0 ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <KeyRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            No API keys yet. Create one to get started.
          </CardContent>
        ) : (
          <div className="divide-y divide-border">
            {keys?.map((key) => (
              <div key={key.id} className="flex items-center gap-3 px-5 py-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <KeyRound className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{key.label}</p>
                    <Badge tone={key.status === "active" ? "success" : "muted"}>{key.status}</Badge>
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {key.keyPrefix}•••••••••••• (last used {key.lastUsedAt ? timeAgo(key.lastUsedAt) : "never"})
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {key.scopes.map((s) => <Badge key={s} tone="muted">{s}</Badge>)}
                  </div>
                </div>
                {key.status === "active" && (
                  <Button variant="ghost" size="icon" aria-label="Revoke key" onClick={() => revokeKey.mutate(key.id, { onSuccess: () => toast.warning("Key revoked", key.label) })}>
                    <Trash2 className="h-4 w-4 text-error" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Create dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} title={createdSecret ? "Key created" : "Create API key"} description={createdSecret ? "Copy your secret now — it won't be shown again." : undefined}>
        {createdSecret ? (
          <div className="space-y-3">
            <div className="rounded-md bg-surface-2 p-3">
              <p className="text-xs font-medium text-muted-foreground">Secret</p>
              <code className="mt-1 block break-all font-mono text-sm text-foreground">{createdSecret}</code>
            </div>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-xs text-muted-foreground"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Stored hashed. Store it securely.</p>
              <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(createdSecret); toast.success("Secret copied"); }}>
                <Copy className="h-4 w-4" /> Copy
              </Button>
            </div>
            <div className="flex justify-end"><Button variant="ghost" onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Production server" autoFocus />
            </div>
            <div>
              <Label>Scopes</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {AVAILABLE_SCOPES.map((s) => {
                  const on = scopes.includes(s);
                  return (
                    <button key={s} onClick={() => toggleScope(s)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-surface-2"}`}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() =>
                  createKey.mutate({ label, scopes }, {
                    onSuccess: (res) => setCreatedSecret(`${res.key.keyPrefix}_${res.secret}`),
                    onError: (e) => toast.error("Could not create key", (e as Error).message),
                  })
                }
                loading={createKey.isPending}
              >
                Create key
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
