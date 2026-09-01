"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Logo } from "@/components/brand/logo";
import { toast } from "@/lib/store/toast";
import { saveAdminSession } from "@/lib/store/admin";
import { env } from "@/lib/config/env";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    if (!email || !password) {
      setError("Enter your email and password.");
      setLoading(false);
      return;
    }

    // api mode → authenticate against the real server (admin RBAC + session).
    if (env.dataLayer === "api") {
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const json = await res.json();
        if (!res.ok || !json?.data?.token) throw new Error(json?.error?.message ?? "Sign-in failed");
        saveAdminSession(json.data.token, json.data.identity.role);
        toast.success("Signed in to admin", `${json.data.identity.role.replace("_", " ")} session started.`);
        router.push("/admin");
        return;
      } catch (err) {
        setError((err as Error).message);
        setLoading(false);
        return;
      }
    }

    // mock mode → demo credentials.
    if (email === "super@cloudcols.com" && password === "admin") {
      saveAdminSession("demo-super-admin", "super_admin");
      toast.success("Signed in to admin", "Super admin session started.");
      router.push("/admin");
    } else {
      saveAdminSession("demo-support", "support");
      toast.success("Signed in to admin");
      router.push("/admin");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo size={34} /></div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Admin console</CardTitle>
            <CardDescription>Restricted area. Authorized staff only.</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@cloudcols.com" required autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              {error && <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}
              <Button type="submit" className="w-full" loading={loading}>Sign in</Button>
            </form>
            <p className="mt-3 rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">
              Demo: <code>super@cloudcols.com</code> / <code>admin</code> for super admin. Any other email = support.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
