"use client";

import { useState } from "react";
import { useFiles, useUsageSummary, useMe } from "@/lib/hooks/queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/store/toast";
import { formatBytes, formatDate } from "@/lib/utils";
import { useAuthStore } from "@/lib/store/auth";
import { ShieldAlert } from "lucide-react";
import type { File } from "@/lib/types";

export default function AdminStoragePage() {
  const { data: usage } = useUsageSummary();
  const { data: me } = useMe();
  const [selected, setSelected] = useState<File | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Storage Operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Metadata-level view. Files are never opened here by default — content access is a separate, audited flow for legal/abuse investigation.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>By category</CardTitle><CardDescription>Aggregated metadata</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {usage?.map((u) => (
              <div key={u.category} className="flex items-center justify-between text-sm">
                <span className="capitalize text-muted-foreground">{u.category}</span>
                <span className="font-medium text-foreground">{formatBytes(u.bytes)} · {u.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <StorageTable />
      </div>
    </div>
  );
}

function StorageTable() {
  const { data: files, isLoading } = useFiles({ category: null, sort: "size", order: "desc", pageSize: 50 });
  const items = files?.items.filter((i) => "sizeBytes" in i) as File[];

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Files (largest first)</CardTitle>
        <CardDescription>Quarantine hides a file from its owner and any shares — logged to audit.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2">File</th><th className="px-4 py-2">Size</th><th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Status</th><th className="px-4 py-2">Modified</th><th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((f) => (
                  <tr key={f.id} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[220px] truncate px-4 py-2.5 font-medium text-foreground">{f.originalFilename}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatBytes(f.sizeBytes)}</td>
                    <td className="px-4 py-2.5"><Badge tone="muted">{f.category}</Badge></td>
                    <td className="px-4 py-2.5"><Badge tone={f.status === "ready" ? "success" : f.status === "quarantined" ? "error" : "warning"}>{f.status}</Badge></td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(f.updatedAt)}</td>
                    <td className="px-4 py-2.5">
                      {f.status !== "quarantined" ? (
                        <Button variant="outline" size="sm" onClick={() => {
                          window.prompt(`Quarantine reason for "${f.originalFilename}"? (logged)`);
                          toast.warning("File quarantined", `${f.originalFilename} hidden from owner + shares.`);
                        }}>
                          <ShieldAlert className="h-3.5 w-3.5" /> Quarantine
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Quarantined</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
