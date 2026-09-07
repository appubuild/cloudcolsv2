"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/api/adminClient";
import { timeAgo } from "@/lib/utils";

/**
 * The audit trail and who holds admin access.
 *
 * Both halves were fiction. The log came from the browser's mock database, and the
 * roles panel printed a fixed list of five roles — Super Admin, Support, Billing,
 * Content, Auditor — three of which the server has never had. Anyone using this
 * page to answer "who can do what" was being told something untrue.
 *
 * Both now read the server. Both endpoints are super_admin-only, so an operator or
 * support admin gets a plain refusal rather than an empty table that reads as "no
 * activity".
 */

interface AuditLog {
  id: string;
  actorId: string | null;
  actorType: "user" | "admin" | "system";
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface Staff {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
}

/** What the server actually enforces — lib/api/adminAuth.ts hasRole(). */
const ROLES: { role: string; label: string; perms: string }[] = [
  { role: "super_admin", label: "Super admin", perms: "Everything, including plans, the audit trail and staff" },
  { role: "support", label: "Support", perms: "Users, files, payments, subscriptions and the developer API" },
  { role: "operator", label: "Operator", perms: "Read-only dashboards" },
];

export default function AdminSecurityPage() {
  const [tab, setTab] = useState("audit");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">Audit trail and admin access.</p>
      </div>
      <Tabs
        tabs={[{ id: "audit", label: "Audit Logs" }, { id: "access", label: "Access Control" }]}
        value={tab}
        onChange={setTab}
      />
      {tab === "audit" && <AuditTab />}
      {tab === "access" && <AccessTab />}
    </div>
  );
}

function useAdminResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    adminFetch<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, [path]);
  return { data, error, reload: load };
}

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="space-y-2">
        <p className="text-sm font-medium text-foreground">Not available</p>
        <p className="text-xs text-muted-foreground">{message}</p>
        <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>
      </CardContent>
    </Card>
  );
}

function AuditTab() {
  const { data: logs, error, reload } = useAdminResource<AuditLog[]>("/api/admin/audit?limit=150");

  if (error) return <Failure message={error} onRetry={reload} />;
  if (!logs) {
    return <Card><CardContent className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</CardContent></Card>;
  }
  if (logs.length === 0) {
    return <Card><CardContent><p className="text-sm text-muted-foreground">Nothing has been logged yet.</p></CardContent></Card>;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  <Badge tone={l.actorType === "admin" ? "info" : l.actorType === "system" ? "muted" : "default"} className="mr-2">
                    {l.actorType}
                  </Badge>
                  <code className="font-mono text-xs">{l.action}</code>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {l.targetType}:{l.targetId}
                  {typeof l.metadata?.reason === "string" ? ` · ${l.metadata.reason}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(l.createdAt)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AccessTab() {
  const { data: staff, error, reload } = useAdminResource<Staff[]>("/api/admin/staff");

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium text-foreground">Roles the server enforces</p>
          {ROLES.map((r) => (
            <div key={r.role} className="flex items-start justify-between gap-4">
              <span className="text-sm font-medium text-foreground">{r.label}</span>
              <span className="text-right text-xs text-muted-foreground">{r.perms}</span>
            </div>
          ))}
          <p className="rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">
            Every admin endpoint calls requireAdmin with a minimum role. Hiding a screen in the
            UI changes nothing on its own.
          </p>
        </CardContent>
      </Card>

      {error && <Failure message={error} onRetry={reload} />}

      {!staff && !error && (
        <Card><CardContent className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</CardContent></Card>
      )}

      {staff && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2">Admin</th><th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Status</th><th className="px-4 py-2">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground">{s.name || s.email}</span>
                      {s.name && <span className="ml-2 text-xs text-muted-foreground">{s.email}</span>}
                    </td>
                    <td className="px-4 py-3"><Badge tone={s.role === "super_admin" ? "info" : "muted"}>{s.role}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={s.isActive ? "success" : "muted"}>{s.isActive ? "Active" : "Disabled"}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {s.lastLoginAt ? timeAgo(s.lastLoginAt) : "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
