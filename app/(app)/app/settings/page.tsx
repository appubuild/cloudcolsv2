"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMe, usePlans, useSubscription, useSubscriptions } from "@/lib/hooks/queries";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";
import { authRepo } from "@/lib/repositories";
import { apiClient } from "@/lib/api/client";
import { env } from "@/lib/config/env";
import { formatBytes, formatDateTime } from "@/lib/utils";
import { Avatar } from "@/components/layout/avatar";
import { Check } from "lucide-react";

export default function SettingsPage() {
  const { data: me } = useMe();
  const [tab, setTab] = useState("profile");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account, security, notifications and billing.</p>
      </div>
      <Tabs
        tabs={[
          { id: "profile", label: "Profile" },
          { id: "security", label: "Security" },
          { id: "notifications", label: "Notifications" },
          { id: "billing", label: "Billing & Plan" },
          { id: "danger", label: "Danger Zone" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "profile" && <ProfileTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "billing" && <BillingTab />}
      {tab === "danger" && <DangerTab />}
    </div>
  );
}

function ProfileTab() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [name, setName] = useState(me?.name ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!me) return;
    setSaving(true);
    try {
      await authRepo.updateProfile(me.id, { name });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Profile updated");
    } catch {
      toast.error("Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your public identity on CloudCols.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={me?.name ?? "U"} size={56} />
          <div>
            <p className="font-medium text-foreground">{me?.name}</p>
            <p className="text-sm text-muted-foreground">{me?.email}</p>
            <Badge tone="muted" className="mt-1">@{me?.username}</Badge>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pname">Display name</Label>
          <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Username</Label>
          <Input value={me?.username ?? ""} disabled />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={me?.email ?? ""} disabled />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} loading={saving}>Save changes</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityTab() {
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const change = async () => {
    if (newPass.length < 8) return toast.error("Password too short", "Use at least 8 characters.");
    if (newPass !== confirm) return toast.error("Passwords don't match");
    setSaving(true);
    try {
      if (env.dataLayer === "api") {
        // Real: server verifies the current password via Supabase Auth, then updates it.
        await apiClient.post("/api/auth/change-password", { currentPassword: current, newPassword: newPass });
        toast.success("Password changed");
      } else {
        await new Promise((r) => setTimeout(r, 600));
        toast.success("Password changed");
      }
      setCurrent(""); setNewPass(""); setConfirm("");
    } catch (err) {
      toast.error("Could not change password", (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label>Current password</Label><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>New password</Label><Input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Confirm new password</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          <div className="flex justify-end"><Button onClick={change} loading={saving}>Update password</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>Add an extra layer of security to your account.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Authenticator app</p>
            <p className="text-xs text-muted-foreground">Not yet enabled in the demo.</p>
          </div>
          <Button variant="secondary">Enable 2FA</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function NotificationsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Choose what you want to hear about.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {[
          { id: "storage", label: "Storage alerts", desc: "When your storage is nearly full." },
          { id: "security", label: "Security events", desc: "New sign-ins, password changes." },
          { id: "shares", label: "Sharing activity", desc: "When files are shared or accessed." },
        ].map((n) => (
          <ToggleRow key={n.id} title={n.label} desc={n.desc} />
        ))}
      </CardContent>
    </Card>
  );
}

function ToggleRow({ title, desc }: { title: string; desc: string }) {
  const [on, setOn] = useState(true);
  return (
    <button onClick={() => setOn(!on)} className="flex w-full items-center justify-between gap-4 text-left">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? "bg-primary" : "bg-surface-2"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${on ? "translate-x-6" : "translate-x-1"}`} />
      </span>
    </button>
  );
}

function BillingTab() {
  const { data: me } = useMe();
  const { data: plans } = usePlans();
  const { data: sub } = useSubscriptions();
  const { checkout } = useSubscription();
  const { data: subscription } = useSubscriptions();
  const plan = plans?.find((p) => p.id === me?.planId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Badge tone={plan?.id === "plan_free" ? "muted" : "info"}>{plan?.name}</Badge>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatBytes(me?.storageQuotaBytes ?? 0)} storage · Renews {sub?.renewsAt ? formatDateTime(sub.renewsAt) : "—"}
            </p>
          </div>
          <Button variant="secondary" onClick={() => checkout.mutate({ planId: me?.planId === "plan_free" ? "plan_plus" : "plan_pro", provider: "card" }, { onSuccess: () => toast.success("Plan updated") })}>
            {plan?.id === "plan_free" ? "Upgrade" : "Change plan"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pick a plan</CardTitle>
          <CardDescription>Prices are shown as configured by the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {(plans ?? []).map((p) => {
              const active = p.id === me?.planId;
              return (
                <div key={p.id} className={`flex flex-col rounded-lg border p-4 ${active ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-foreground">{p.name}</p>
                    {active && <Badge tone="info">Current</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
                  <p className="mt-2 text-xl font-bold text-foreground">
                    {p.priceCents === 0 ? "Free" : `$${(p.priceCents / 100).toFixed(2)}`}
                    {p.billingInterval && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                  </p>
                  <ul className="mt-3 flex-1 space-y-1 text-sm text-muted-foreground">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {f}</li>
                    ))}
                  </ul>
                  {!active && (
                    <Button variant="secondary" className="mt-4" onClick={() => checkout.mutate({ planId: p.id, provider: "card" }, { onSuccess: () => toast.success(`Switched to ${p.name}`) })}>
                      Switch to {p.name}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DangerTab() {
  const router = useRouter();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [confirmText, setConfirmText] = useState("");

  const del = async () => {
    if (confirmText !== "DELETE") return toast.error("Type DELETE to confirm");
    if (!me) return;
    await authRepo.deleteAccount(me.id);
    await qc.invalidateQueries();
    toast.success("Account deleted", "Your files have been removed.");
    router.push("/");
  };

  return (
    <Card className="border-error/40">
      <CardHeader>
        <CardTitle className="text-error">Delete account</CardTitle>
        <CardDescription>This permanently deletes your account and all files. This cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="dc">Type <code className="text-error">DELETE</code> to confirm</Label>
          <Input id="dc" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
        </div>
        <div className="flex justify-end">
          <Button variant="destructive" onClick={del}>Delete my account</Button>
        </div>
      </CardContent>
    </Card>
  );
}
