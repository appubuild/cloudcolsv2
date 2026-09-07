"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { toast } from "@/lib/store/toast";
import { adminFetch } from "@/lib/api/adminClient";
import { formatBytes, formatDate } from "@/lib/utils";
import { Search, ChevronRight } from "lucide-react";

/**
 * Accounts.
 *
 * Suspend used to call `authRepo.updateProfile(id, { status: "suspended" })` — the
 * end user's own profile repository, which PATCHes /api/profile with whatever
 * session the browser holds and accepts only a name and an avatar. It ignored the id
 * it was given, discarded the reason it had just prompted for, reported success and
 * reloaded. Nobody was ever suspended. It calls /api/admin/users/[id] now, and a
 * suspended account is refused by requireUser on every request.
 */

interface AdminUser {
  id: string;
  email: string;
  name: string;
  planId: string;
  status: string;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  createdAt: string | null;
  lastLoginAt: string | null;
  countryCode: string | null;
  setupCompleted: boolean;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [acting, setActing] = useState<{ user: AdminUser; action: "suspend" | "restore" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminFetch<{ items: AdminUser[] }>("/api/admin/users?pageSize=100")
      .then((res) => {
        setUsers(res.items ?? []);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    let list = users ?? [];
    if (filter === "active") list = list.filter((u) => u.status === "active");
    if (filter === "suspended") list = list.filter((u) => u.status === "suspended");
    if (filter === "setup") list = list.filter((u) => !u.setupCompleted);
    if (filter === "free") list = list.filter((u) => u.planId === "plan_free");
    if (filter === "paid") list = list.filter((u) => u.planId !== "plan_free");
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((u) => u.email.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle));
    }
    return list;
  }, [users, q, filter]);

  const submit = async () => {
    if (!acting) return;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/users/${acting.user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: acting.action, reason: reason.trim() }),
      });
      toast.success(
        acting.action === "suspend" ? "Account suspended" : "Account reinstated",
        acting.action === "suspend"
          ? `${acting.user.email || acting.user.id} can no longer reach their files.`
          : `${acting.user.email || acting.user.id} has access again.`,
      );
      setActing(null);
      setReason("");
      load();
    } catch (e) {
      toast.error("Could not apply that", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Accounts, plans, storage and status.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users…" className="w-64 pl-9" />
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "all", label: "All" },
          { id: "active", label: "Active" },
          { id: "suspended", label: "Suspended" },
          { id: "setup", label: "Setup pending" },
          { id: "free", label: "Free" },
          { id: "paid", label: "Paid" },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {error && (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-foreground">Could not load accounts</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {!users && !error ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-4 py-2">User</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Storage</th>
                    <th className="px-4 py-2">Status</th><th className="px-4 py-2">Setup</th>
                    <th className="px-4 py-2">Last seen</th><th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                      <td className="px-4 py-3">
                        {/* The whole point of the list is getting to one account. */}
                        <Link href={`/admin/users/${u.id}`} className="group block">
                          <p className="font-medium text-foreground group-hover:text-primary">
                            {u.name} <ChevronRight className="inline h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                          </p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </Link>
                      </td>
                      <td className="px-4 py-3"><Badge tone={u.planId === "plan_free" ? "muted" : "info"}>{u.planId.replace("plan_", "")}</Badge></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                        {formatBytes(u.storageUsedBytes)} / {formatBytes(u.storageQuotaBytes)}
                      </td>
                      <td className="px-4 py-3"><Badge tone={u.status === "active" ? "success" : "warning"}>{u.status}</Badge></td>
                      <td className="px-4 py-3">
                        {u.setupCompleted ? (
                          <Badge tone="success">{u.countryCode ?? "done"}</Badge>
                        ) : (
                          <Badge tone="muted">pending</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {u.lastLoginAt ? formatDate(u.lastLoginAt) : u.createdAt ? `joined ${formatDate(u.createdAt)}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {u.status === "active" ? (
                          <Button variant="outline" size="sm" onClick={() => setActing({ user: u, action: "suspend" })}>Suspend</Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setActing({ user: u, action: "restore" })}>Reinstate</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">No users match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {acting && (
        <Dialog
          open
          onClose={() => (busy ? undefined : (setActing(null), setReason("")))}
          title={acting.action === "suspend" ? "Suspend account" : "Reinstate account"}
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {acting.action === "suspend" ? (
                <>
                  <span className="font-medium text-foreground">{acting.user.email || acting.user.id}</span> will be
                  refused on every request — reading files included — until reinstated. Nothing is deleted.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{acting.user.email || acting.user.id}</span> gets
                  access back immediately.
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
                {busy ? "Working…" : acting.action === "suspend" ? "Suspend" : "Reinstate"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
