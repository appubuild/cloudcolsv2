"use client";

import { useState } from "react";
import { useShared, useShare, useInvitations, useInvite } from "@/lib/hooks/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/misc";
import { EmptyState } from "@/components/files/empty-state";
import { toast } from "@/lib/store/toast";
import { formatDate, formatBytes } from "@/lib/utils";
import { CategoryThumb } from "@/components/files/category-thumb";
import { Share2, Link2, Copy, Trash2, Folder as FolderIcon, Check, X } from "lucide-react";
import type { ShareLink, ShareInvitation } from "@/lib/types";

export default function SharedPage() {
  const { data: shares, isLoading } = useShared();
  const { revoke } = useShare();
  const { data: incoming } = useInvitations("incoming");
  const { data: outgoing } = useInvitations("outgoing");
  const { respond } = useInvite();
  const [tab, setTab] = useState("byMe");

  const pending = (incoming ?? []).filter((i) => i.status === "pending");
  const accepted = (incoming ?? []).filter((i) => i.status === "accepted");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Shared</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage the links you've created and files shared with you.</p>
      </div>

      <Tabs
        tabs={[
          { id: "byMe", label: `Shared by me (${(shares?.filter((s) => !s.isRevoked).length ?? 0) + (outgoing?.length ?? 0)})` },
          { id: "withMe", label: `Shared with me (${(incoming ?? []).length})` },
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
      ) : (incoming ?? []).length === 0 ? (
        <EmptyState
          icon={<Share2 className="h-7 w-7" />}
          title="Nothing shared with you"
          description="Files others share with you will appear here."
        />
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Waiting for you</CardTitle>
              </CardHeader>
              <div className="divide-y divide-border">
                {pending.map((i) => (
                  <InvitationRow
                    key={i.id}
                    invitation={i}
                    onAccept={() =>
                      respond.mutate(
                        { id: i.id, action: "accept" },
                        { onSuccess: () => toast.success("Added to your shared files", i.itemName) },
                      )
                    }
                    onDecline={() =>
                      respond.mutate(
                        { id: i.id, action: "decline" },
                        { onSuccess: () => toast.success("Invitation declined", i.itemName) },
                      )
                    }
                  />
                ))}
              </div>
            </Card>
          )}

          {accepted.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Shared with you</CardTitle>
              </CardHeader>
              <div className="divide-y divide-border">
                {accepted.map((i) => (
                  <InvitationRow key={i.id} invitation={i} />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One invitation, from the recipient's side.
 *
 * Accept and Decline are only offered while it is pending; afterwards the row
 * says what happened rather than showing buttons that would do nothing.
 */
function InvitationRow({
  invitation,
  onAccept,
  onDecline,
}: {
  invitation: ShareInvitation;
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  const href =
    invitation.itemKind === "folder" && invitation.folderId
      ? `/app/files/${invitation.folderId}`
      : "/app/files";

  return (
    <div className="flex items-center gap-3 px-5 py-4">
      {invitation.itemKind === "folder" ? (
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FolderIcon className="h-5 w-5" />
        </span>
      ) : (
        <CategoryThumb category={(invitation.category as never) ?? "other"} />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{invitation.itemName}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge tone={invitation.permission === "editor" ? "info" : "muted"}>
            {invitation.permission === "editor" ? "Editor" : "Viewer"}
          </Badge>
          {invitation.status === "accepted" && <Badge tone="success">Accepted</Badge>}
          {invitation.status === "declined" && <Badge tone="muted">Declined</Badge>}
          <span>Shared {formatDate(invitation.createdAt)}</span>
          {invitation.sizeBytes ? <span>{formatBytes(invitation.sizeBytes)}</span> : null}
        </div>
        {invitation.message && (
          <p className="mt-1 truncate text-xs text-muted-foreground">&ldquo;{invitation.message}&rdquo;</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onAccept && onDecline ? (
          <>
            <Button size="sm" onClick={onAccept}>
              <Check className="h-4 w-4" /> Accept
            </Button>
            <Button size="sm" variant="ghost" onClick={onDecline}>
              <X className="h-4 w-4" /> Decline
            </Button>
          </>
        ) : invitation.status === "accepted" ? (
          <Button size="sm" variant="secondary" onClick={() => (window.location.href = href)}>
            Open
          </Button>
        ) : null}
      </div>
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
