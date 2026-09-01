"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/misc";
import { getDb } from "@/lib/mock/db";
import { timeAgo } from "@/lib/utils";

export default function AdminSecurityPage() {
  const [tab, setTab] = useState("audit");
  const logs = getDb().auditLogs;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">Audit trail, admin activity and access control.</p>
      </div>
      <Tabs tabs={[{ id: "audit", label: "Audit Logs" }, { id: "admin", label: "Admin Activity" }, { id: "access", label: "Access Control" }]} value={tab} onChange={setTab} />

      {tab === "audit" && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {logs.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      <Badge tone={l.actorType === "admin" ? "info" : l.actorType === "system" ? "muted" : "default"} className="mr-2">{l.actorType}</Badge>
                      <code className="font-mono text-xs">{l.action}</code>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {l.targetType}:{l.targetId} {l.metadata?.reason ? `· ${l.metadata.reason}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(l.createdAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "access" && (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium text-foreground">Admin roles</p>
            {[
              { role: "Super Admin", perms: "Everything" },
              { role: "Support", perms: "View users, suspend/restore" },
              { role: "Billing", perms: "Plans, payments, refunds" },
              { role: "Content", perms: "Landing, FAQ, ads, announcements" },
              { role: "Auditor", perms: "Read-only dashboards, logs" },
            ].map((r) => (
              <div key={r.role} className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{r.role}</span>
                <span className="text-xs text-muted-foreground">{r.perms}</span>
              </div>
            ))}
            <p className="rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">
              RBAC is enforced server-side in production. UI hiding is cosmetic only.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
