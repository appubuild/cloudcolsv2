"use client";

import { useState } from "react";
import { useShared, useShare } from "@/lib/hooks/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/misc";
import { EmptyState } from "@/components/files/empty-state";
import { toast } from "@/lib/store/toast";
import { formatDate, formatBytes } from "@/lib/utils";
import { CategoryThumb } from "@/components/files/category-thumb";
import { Share2, Link2, Copy, Trash2 } from "lucide-react";
import type { ShareLink } from "@/lib/types";

export default function SharedPage() {
  const { data: shares, isLoading } = useShared();
  const { revoke } = useShare();
  const [tab, setTab] = useState("byMe");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Shared</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage the links you've created and files shared with you.</p>
      </div>

      <Tabs
        tabs={[
          { id: "byMe", label: `Shared by me (${shares?.filter((s) => !s.isRevoked).length ?? 0})` },
          { id: "withMe", label: "Shared with me" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "byMe" ? (
        shares?.length ? (
          <Card>
            <div className="divide-y divide-border">
              {shares.map((s) => (
                <ShareRow key={s.id} share={s} onRevoke={() => revoke.mutate(s.id, { onSuccess: () => toast.success("Link revoked") })} />
              ))}
            </div>
          </Card>
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Share2 className="h-7 w-7" />}
            title="No shared links yet"
            description="Select a file or folder and choose Share to create a link."
          />
        )
      ) : (
        <EmptyState
          icon={<Share2 className="h-7 w-7" />}
          title="Nothing shared with you"
          description="Files others share with you will appear here."
        />
      )}
    </div>
  );
}

function ShareRow({ share, onRevoke }: { share: ShareLink; onRevoke: () => void }) {
  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/s/${share.token}`;
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Link2 className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{share.token}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge tone={share.permission === "download" ? "info" : "muted"}>
            {share.permission === "download" ? "Download" : "View only"}
          </Badge>
          {share.expiresAt && <Badge tone={share.isRevoked ? "error" : "warning"}>Expires {formatDate(share.expiresAt)}</Badge>}
          {share.isRevoked && <Badge tone="error">Revoked</Badge>}
          <span>{share.accessCount} views</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Copy link" onClick={() => { navigator.clipboard?.writeText(link); toast.success("Link copied"); }}>
          <Copy className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Revoke" onClick={onRevoke} className={share.isRevoked ? "opacity-50" : ""}>
          <Trash2 className="h-4 w-4 text-error" />
        </Button>
      </div>
    </div>
  );
}
