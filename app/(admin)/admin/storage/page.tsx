"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { toast } from "@/lib/store/toast";
import { adminFetch } from "@/lib/api/adminClient";
import { formatBytes, formatDate } from "@/lib/utils";
import { ShieldAlert, ShieldCheck, Search } from "lucide-react";

/**
 * Storage Operations, across the whole platform.
 *
 * This screen used to call the ordinary user hooks — useFiles, useUsageSummary,
 * useMe — which send the signed-in *user's* token. So a page titled "Storage
 * Operations", listing largest files first, was showing whichever end-user session
 * happened to be in the browser, and nothing said so. It reads /api/admin/files now.
 *
 * The Quarantine button used to open a prompt, discard the answer, and show "File
 * quarantined — hidden from owner + shares" without making a request. It calls the
 * server now, and quarantining genuinely stops the file being served: the owner's
 * download, the admin preview and any public share link all require `ready`.
 */

interface AdminFile {
  id: string;
  ownerId: string;
  ownerEmail: string;
  originalFilename: string;
  category: string;
  sizeBytes: number;
  status: string;
  updatedAt: string;
  trashedAt: string | null;
}

interface Listing {
  items: AdminFile[];
  total: number;
  page: number;
  pageSize: number;
}

interface Analytics {
  storage: {
    usedBytes: number;
    fileCount: number;
    folderCount: number;
    byCategory: { category: string; bytes: number; count: number }[];
  };
}

const STATUS_TONE: Record<string, "success" | "warning" | "error" | "muted"> = {
  ready: "success",
  pending: "warning",
  processing: "warning",
  quarantined: "error",
};

export default function AdminStoragePage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<{ file: AdminFile; action: "quarantine" | "release" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const loadListing = useCallback(() => {
    const params = new URLSearchParams({ sort: "size", order: "desc", pageSize: "50" });
    if (tab === "quarantined") params.set("status", "quarantined");
    if (tab === "trashed") params.set("status", "trashed");
    if (search.trim()) params.set("search", search.trim());

    adminFetch<Listing>(`/api/admin/files?${params}`)
      .then((data) => {
        setListing(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [tab, search]);

  useEffect(() => {
    adminFetch<Analytics>("/api/admin/analytics").then(setAnalytics).catch(() => setAnalytics(null));
  }, []);

  useEffect(() => {
    // Debounced so typing does not fire a query per keystroke.
    const t = setTimeout(loadListing, 250);
    return () => clearTimeout(t);
  }, [loadListing]);

  const submit = async () => {
    if (!acting) return;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/files/${acting.file.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: acting.action, reason: reason.trim() }),
      });
      toast.success(
        acting.action === "quarantine" ? "File quarantined" : "File released",
        acting.action === "quarantine"
          ? `${acting.file.originalFilename} can no longer be downloaded or shared.`
          : `${acting.file.originalFilename} is available again.`,
      );
      setActing(null);
      setReason("");
      loadListing();
    } catch (e) {
      toast.error("Could not apply that", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Storage Operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every account&apos;s files, by size. Metadata only — opening a file is a separate, audited action
          on the account&apos;s own page.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>By category</CardTitle>
            <CardDescription>
              {analytics
                ? `${formatBytes(analytics.storage.usedBytes)} across ${analytics.storage.fileCount.toLocaleString()} files`
                : "Platform totals"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!analytics && [0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
            {analytics?.storage.byCategory.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing stored yet.</p>
            )}
            {analytics?.storage.byCategory.map((u) => (
              <div key={u.category} className="flex items-center justify-between text-sm">
                <span className="capitalize text-muted-foreground">{u.category}</span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatBytes(u.bytes)} · {u.count}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Files</CardTitle>
                <CardDescription>Largest first. Quarantine stops a file being downloaded or shared.</CardDescription>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search filenames…"
                  className="w-56 pl-9"
                />
              </div>
            </div>
            <Tabs
              tabs={[
                { id: "all", label: "All" },
                { id: "quarantined", label: "Quarantined" },
                { id: "trashed", label: "Trashed" },
              ]}
              value={tab}
              onChange={setTab}
            />
          </CardHeader>
          <CardContent className="p-0">
            {error && (
              <div className="space-y-2 p-4">
                <p className="text-sm text-foreground">Could not load files</p>
                <p className="text-xs text-muted-foreground">{error}</p>
                <Button size="sm" variant="secondary" onClick={loadListing}>Try again</Button>
              </div>
            )}
            {!listing && !error && (
              <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            )}
            {listing && listing.items.length === 0 && !error && (
              <p className="p-4 text-sm text-muted-foreground">Nothing here.</p>
            )}
            {listing && listing.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-4 py-2">File</th><th className="px-4 py-2">Owner</th><th className="px-4 py-2">Size</th>
                      <th className="px-4 py-2">Type</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Modified</th>
                      <th className="px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listing.items.map((f) => (
                      <tr key={f.id} className="border-b border-border/60 last:border-0">
                        <td className="max-w-[220px] truncate px-4 py-2.5 font-medium text-foreground">{f.originalFilename}</td>
                        <td className="px-4 py-2.5 text-xs">
                          <Link href={`/admin/users/${f.ownerId}`} className="text-primary hover:underline">
                            {f.ownerEmail || `${f.ownerId.slice(0, 8)}…`}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{formatBytes(f.sizeBytes)}</td>
                        <td className="px-4 py-2.5"><Badge tone="muted">{f.category}</Badge></td>
                        <td className="px-4 py-2.5">
                          <Badge tone={STATUS_TONE[f.status] ?? "muted"}>{f.trashedAt ? "trashed" : f.status}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(f.updatedAt)}</td>
                        <td className="px-4 py-2.5">
                          {f.status === "quarantined" ? (
                            <Button variant="outline" size="sm" onClick={() => setActing({ file: f, action: "release" })}>
                              <ShieldCheck className="h-3.5 w-3.5" /> Release
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => setActing({ file: f, action: "quarantine" })}>
                              <ShieldAlert className="h-3.5 w-3.5" /> Quarantine
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {listing.total > listing.items.length && (
                  <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                    Showing the {listing.items.length} largest of {listing.total.toLocaleString()}.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {acting && (
        <Dialog
          open
          onClose={() => (busy ? undefined : (setActing(null), setReason("")))}
          title={acting.action === "quarantine" ? "Quarantine file" : "Release file"}
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {acting.action === "quarantine" ? (
                <>
                  <span className="font-medium text-foreground">{acting.file.originalFilename}</span> will stop
                  being downloadable by its owner and by anyone holding a share link. It stays in their file
                  list, marked, so they are not left wondering where it went.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{acting.file.originalFilename}</span> becomes
                  available again to its owner and to any share links still active.
                </>
              )}
            </p>
            <div className="space-y-1.5">
              <label htmlFor="reason" className="text-sm font-medium text-foreground">Reason</label>
              <Input
                id="reason"
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Recorded in the audit log"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setActing(null); setReason(""); }} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy || reason.trim().length < 3}>
                {busy ? "Working…" : acting.action === "quarantine" ? "Quarantine" : "Release"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
