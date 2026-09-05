"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { CategoryThumb } from "@/components/files/category-thumb";
import { FolderGlyph } from "@/components/files/folder-icon";
import { adminFetch } from "@/lib/api/adminClient";
import { toast } from "@/lib/store/toast";
import { formatBytes, formatDate } from "@/lib/utils";
import { ArrowLeft, AlertTriangle, Eye, Search } from "lucide-react";
import type { FileCategory } from "@/lib/types";

interface Detail {
  id: string;
  email: string;
  status: string;
  planId: string;
  developerEnabled: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  storage: {
    quotaBytes: number;
    usedBytes: number;
    computedBytes: number;
    drifts: boolean;
    fileCount: number;
    trashedCount: number;
    folderCount: number;
    byCategory: { category: string; bytes: number; count: number }[];
  };
  subscription: {
    planId: string;
    status: string;
    provider: string | null;
    startedAt: string | null;
    renewsAt: string | null;
  } | null;
  payments: { id: string; amountCents: number; currency: string; status: string; provider: string | null; createdAt: string }[];
}

interface Listing {
  items: {
    id: string;
    parentId?: string | null;
    name?: string;
    icon?: string | null;
    originalFilename?: string;
    category?: FileCategory;
    sizeBytes?: number;
    updatedAt?: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One account, for support and abuse investigation.
 *
 * The file browser is here rather than on its own route because the reason to
 * look at someone's files is always a question about the account — and having to
 * navigate away from the account to answer it is how people end up looking at the
 * wrong one.
 */
export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = String(params?.id ?? "");

  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState("overview");
  const [listing, setListing] = useState<Listing | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<{ url: string; filename: string; category: string } | null>(null);

  useEffect(() => {
    adminFetch<Detail>(`/api/admin/users/${userId}`)
      .then(setDetail)
      .catch((e) => toast.error("Could not load the account", (e as Error).message));
  }, [userId]);

  useEffect(() => {
    if (tab !== "files") return;
    const query = new URLSearchParams({ page: String(page), pageSize: "30" });
    if (folderId) query.set("folderId", folderId);
    if (search) query.set("search", search);
    adminFetch<Listing>(`/api/admin/users/${userId}/files?${query}`)
      .then(setListing)
      .catch((e) => toast.error("Could not load files", (e as Error).message));
  }, [tab, userId, folderId, search, page]);

  const openPreview = async (fileId: string) => {
    try {
      // Every use of this is written to the audit log before the URL is issued.
      const data = await adminFetch<{ url: string; filename: string; category: string }>(
        `/api/admin/files/${fileId}/preview`,
      );
      setPreview(data);
    } catch (e) {
      toast.error("Could not open the file", (e as Error).message);
    }
  };

  if (!detail) return <Skeleton className="h-96 rounded-xl" />;

  const usedPct = detail.storage.quotaBytes
    ? Math.min(100, Math.round((detail.storage.usedBytes / detail.storage.quotaBytes) * 100))
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/users">
          <Button variant="ghost" size="icon" aria-label="Back to users">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-foreground">{detail.email || detail.id}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge tone={detail.status === "active" ? "success" : "error"}>{detail.status}</Badge>
            <Badge tone="info">{detail.planId.replace("plan_", "")}</Badge>
            {detail.developerEnabled && <Badge tone="muted">developer</Badge>}
            <span>Joined {detail.createdAt ? formatDate(detail.createdAt) : "—"}</span>
            <span>Last seen {detail.lastLoginAt ? formatDate(detail.lastLoginAt) : "never"}</span>
          </div>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "files", label: `Files (${detail.storage.fileCount})` },
          { id: "billing", label: `Billing (${detail.payments.length})` },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setPage(1);
        }}
      />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Storage</CardTitle>
              <CardDescription>
                {formatBytes(detail.storage.usedBytes)} of {formatBytes(detail.storage.quotaBytes)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">{usedPct}% used</p>

              {detail.storage.drifts && (
                <p className="flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {/* The recorded figure is what enforces the quota, so a
                      disagreement means enforcement is working off a wrong number. */}
                  Recorded {formatBytes(detail.storage.usedBytes)} but the files add up to{" "}
                  {formatBytes(detail.storage.computedBytes)}.
                </p>
              )}

              <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-surface-2 p-2">
                  <dt className="text-muted-foreground">Files</dt>
                  <dd className="font-semibold text-foreground tabular-nums">{detail.storage.fileCount}</dd>
                </div>
                <div className="rounded-md bg-surface-2 p-2">
                  <dt className="text-muted-foreground">Folders</dt>
                  <dd className="font-semibold text-foreground tabular-nums">{detail.storage.folderCount}</dd>
                </div>
                <div className="rounded-md bg-surface-2 p-2">
                  <dt className="text-muted-foreground">Trashed</dt>
                  <dd className="font-semibold text-foreground tabular-nums">{detail.storage.trashedCount}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>By file type</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.storage.byCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing stored yet.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.storage.byCategory.map((c) => (
                    <div key={c.category} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                      <CategoryThumb category={c.category as FileCategory} className="h-8 w-8" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium capitalize text-foreground">{c.category}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {c.count} · {formatBytes(c.bytes)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "files" && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search this account's files…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-8"
                />
              </div>
              {folderId && (
                <Button variant="secondary" size="sm" onClick={() => { setFolderId(null); setPage(1); }}>
                  Back to root
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!listing ? (
              <Skeleton className="h-40" />
            ) : listing.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p>
            ) : (
              <div className="divide-y divide-border">
                {listing.items.map((item) => {
                  const isFolder = "parentId" in item;
                  return (
                    <div key={item.id} className="flex items-center gap-3 py-2.5">
                      {isFolder ? (
                        <FolderGlyph icon={item.icon} className="h-9 w-9" iconClassName="h-4 w-4" />
                      ) : (
                        <CategoryThumb category={(item.category ?? "other") as FileCategory} className="h-9 w-9" />
                      )}
                      <button
                        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:text-primary"
                        onClick={() => {
                          if (isFolder) {
                            setFolderId(item.id);
                            setPage(1);
                          } else {
                            void openPreview(item.id);
                          }
                        }}
                      >
                        {isFolder ? item.name : item.originalFilename}
                      </button>
                      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
                        {isFolder ? "—" : formatBytes(item.sizeBytes ?? 0)}
                      </span>
                      <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground sm:block">
                        {item.updatedAt ? formatDate(item.updatedAt) : "—"}
                      </span>
                      {!isFolder && (
                        <Button variant="ghost" size="icon" aria-label="Preview" onClick={() => void openPreview(item.id)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {listing && listing.total > listing.pageSize && (
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground tabular-nums">
                  Page {listing.page} of {Math.ceil(listing.total / listing.pageSize)} · {listing.total} items
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= Math.ceil(listing.total / listing.pageSize)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "billing" && (
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>
              {detail.subscription
                ? `${detail.subscription.planId} · ${detail.subscription.status} · ${detail.subscription.provider ?? "—"}`
                : "No subscription on record."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments.</p>
            ) : (
              <div className="divide-y divide-border">
                {detail.payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="flex-1 truncate text-muted-foreground">{formatDate(p.createdAt)}</span>
                    <Badge
                      tone={p.status === "succeeded" ? "success" : p.status === "failed" ? "error" : "muted"}
                    >
                      {p.status}
                    </Badge>
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">{p.provider ?? "—"}</span>
                    <span className="w-20 shrink-0 text-right font-medium text-foreground tabular-nums">
                      {(p.amountCents / 100).toFixed(2)} {p.currency}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          <div className="max-h-full max-w-4xl overflow-auto" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-center text-sm text-white/80">{preview.filename}</p>
            {preview.category === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL.
              <img src={preview.url} alt={preview.filename} className="max-h-[80vh] rounded-lg" />
            ) : preview.category === "video" ? (
              <video src={preview.url} controls preload="metadata" className="max-h-[80vh] rounded-lg" />
            ) : preview.category === "audio" ? (
              <audio src={preview.url} controls className="w-96" />
            ) : preview.category === "pdf" ? (
              <iframe src={preview.url} title={preview.filename} className="h-[80vh] w-[80vw] rounded-lg bg-white" sandbox="" />
            ) : (
              <p className="rounded-lg bg-surface p-6 text-sm text-muted-foreground">
                This file type cannot be previewed.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
