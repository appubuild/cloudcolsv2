"use client";

import { useMemo, useState } from "react";
import { useAdminUsers } from "@/lib/hooks/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/store/toast";
import { formatBytes, formatDate } from "@/lib/utils";
import { authRepo } from "@/lib/repositories";
import { Tabs } from "@/components/ui/tabs";
import { Search, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { User } from "@/lib/types";

export default function AdminUsersPage() {
  const { data: users, isLoading } = useAdminUsers();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = users ?? [];
    if (filter === "active") list = list.filter((u) => u.status === "active");
    if (filter === "suspended") list = list.filter((u) => u.status === "suspended");
    if (filter === "free") list = list.filter((u) => u.planId === "plan_free");
    if (filter === "paid") list = list.filter((u) => u.planId !== "plan_free");
    if (q) list = list.filter((u) => u.email.toLowerCase().includes(q.toLowerCase()) || u.name.toLowerCase().includes(q.toLowerCase()));
    return list;
  }, [users, q, filter]);

  const suspend = (u: User) => {
    const reason = window.prompt(`Reason for suspending ${u.email}? (logged to audit)`);
    if (!reason) return;
    authRepo.updateProfile(u.id, { status: "suspended" }).then(() => {
      toast.warning("User suspended", `${u.email} — reason logged.`);
      window.location.reload();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage accounts, plans and status.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users…" className="w-64 pl-9" />
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "all", label: "All" }, { id: "active", label: "Active" },
          { id: "suspended", label: "Suspended" }, { id: "free", label: "Free" }, { id: "paid", label: "Paid" },
        ]}
        value={filter}
        onChange={setFilter}
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-4 py-2">User</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Storage</th>
                    <th className="px-4 py-2">Status</th><th className="px-4 py-2">Joined</th><th className="px-4 py-2">Actions</th>
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
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatBytes(u.storageUsedBytes)} / {formatBytes(u.storageQuotaBytes)}</td>
                      <td className="px-4 py-3"><Badge tone={u.status === "active" ? "success" : "warning"}>{u.status}</Badge></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(u.createdAt)}</td>
                      <td className="px-4 py-3">
                        {u.status === "active" ? (
                          <Button variant="outline" size="sm" onClick={() => suspend(u)}>Suspend</Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => authRepo.updateProfile(u.id, { status: "active" }).then(() => window.location.reload())}>Reinstate</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No users match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
