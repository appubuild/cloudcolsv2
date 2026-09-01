"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMe, usePlans, useFavoriteFolders, useRecentFolders, useRecentAccess, useMutateFiles, useFiles } from "@/lib/hooks/queries";
import { formatBytes } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { StorageRing } from "@/components/files/storage-ring";
import { RecentAccessList } from "@/components/files/recent-access-list";
import { FolderCard } from "@/components/files/folder-card";
import { Upload, CloudOff, ArrowRight, Files as FilesIcon, Star, Folder as FolderIcon, Clock } from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: plans } = usePlans();
  const { data: favFolders } = useFavoriteFolders();
  const { data: recentFolders } = useRecentFolders();
  const { data: recentAccess, isLoading: recentLoading } = useRecentAccess(8);
  const { data: recent } = useFiles({ recent: true, sort: "accessed", order: "desc", pageSize: 6 });
  const { markAccessed } = useMutateFiles();

  const plan = plans?.find((p) => p.id === me?.planId);
  const quotaPct = me ? (me.storageUsedBytes / me.storageQuotaBytes) * 100 : 0;
  const onFreePlan = me?.planId === "plan_free";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="cc-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{greeting()}, {me?.name?.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back — here's what's happening with your files.</p>
        </div>
        <Link href="/app/files">
          <Button><Upload className="h-4 w-4" /> Upload / Browse</Button>
        </Link>
      </div>

      {/* Free plan banner */}
      {onFreePlan && (
        <Card className="border-primary/30 bg-primary-soft">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white"><CloudOff className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-semibold text-foreground">You're on the {plan?.name ?? "Free"} plan</p>
                <p className="text-sm text-muted-foreground">Upgrade for more storage, no ads, and larger uploads.</p>
              </div>
            </div>
            <Link href="/app/storage"><Button size="sm">Upgrade</Button></Link>
          </CardContent>
        </Card>
      )}

      {/* Top stats + storage */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="cc-lift lg:col-span-1">
          <CardHeader>
            <CardTitle>Storage</CardTitle>
            <CardDescription>{plan?.name} plan</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <StorageRing value={quotaPct} />
            <div className="mt-3 text-center">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{formatBytes(me?.storageUsedBytes ?? 0)}</span> of {formatBytes(me?.storageQuotaBytes ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">{Math.max(0, Math.round(100 - quotaPct))}% remaining</p>
            </div>
            <Link href="/app/storage" className="mt-4 w-full"><Button variant="secondary" className="w-full">View storage details</Button></Link>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          <StatCard icon={<FilesIcon className="h-5 w-5" />} label="Files" value={(recent?.total ?? 0).toString()} />
          <StatCard icon={<Star className="h-5 w-5" />} label="Favorites" value={(favFolders?.length ?? 0).toString()} />
          <StatCard icon={<Clock className="h-5 w-5" />} label="Recently used" value={(recentAccess?.length ?? 0).toString()} />
        </div>
      </div>

      {/* Favorite folders */}
      <DashboardSection
        title="Favorite folders"
        subtitle="Quick access to the folders you care about"
        action={<Link href="/app/files" className="text-sm font-medium text-primary hover:underline">All folders <ArrowRight className="inline h-3.5 w-3.5" /></Link>}
      >
        {!favFolders ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ) : favFolders.length === 0 ? (
          <EmptyHint text="No favorite folders yet. Star folders to pin them here." />
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {favFolders.slice(0, 8).map((f, i) => (
              <div key={f.id} className="cc-fade-up cc-stagger" style={{ ["--stagger" as any]: i }}>
                <FolderCard folder={f} compact />
              </div>
            ))}
          </div>
        )}
      </DashboardSection>

      {/* Two-column: recent access + recent folders */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentAccessList items={recentAccess ?? []} loading={recentLoading} limit={6} onToggleFavorite={(id) => router.push(`/app/files/${encodeURIComponent(id)}`)} />
        </div>

        <DashboardSection
          title="Recent folders"
          subtitle="Folders you've opened or modified"
          action={<Link href="/app/recent" className="text-sm font-medium text-primary hover:underline">View all</Link>}
        >
          {!recentFolders ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : recentFolders.length === 0 ? (
            <EmptyHint text="Recent folders will appear here." />
          ) : (
            <div className="space-y-1">
              {recentFolders.slice(0, 6).map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    markAccessed.mutate({ type: "folder", id: f.id });
                    router.push(`/app/files/${encodeURIComponent(f.id)}`);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-surface-2"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500"><FolderIcon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{f.name}</p>
                    <p className="text-xs text-muted-foreground">{f.path}</p>
                  </div>
                  {f.isFavorite && <Star className="h-4 w-4 fill-amber-500 text-amber-500" />}
                </button>
              ))}
            </div>
          )}
        </DashboardSection>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="cc-lift cc-fade-up">
      <CardContent className="py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <p className="mt-3 text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function DashboardSection({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-surface/50 py-8 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
