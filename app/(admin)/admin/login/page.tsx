"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Logo } from "@/components/brand/logo";
import { Spinner } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";
import { saveAdminSession, getAdminRole } from "@/lib/store/admin";
import { useAuthStore } from "@/lib/store/auth";
import { apiClient } from "@/lib/api/client";
import { env } from "@/lib/config/env";
import { ShieldX } from "lucide-react";

/**
 * The admin console's door.
 *
 * It used to show the same password form to everyone: to staff who had signed in to
 * the app moments earlier and had to type the same password again, and to ordinary
 * customers, who tried and were told their credentials were invalid — which was not
 * what was wrong with their request.
 *
 * Three states now, decided before anything is drawn:
 *
 *   - an admin session already exists      → straight to /admin
 *   - signed in, and the account is staff  → a staff session is issued, then /admin
 *   - signed in, and it is not             → told plainly that it is not, with a way back
 *
 * Someone who is not signed in at all still gets the form.
 */
type Gate = "checking" | "form" | "denied";

export default function AdminLoginPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const sessionLoading = useAuthStore((s) => s.loading);

  const [gate, setGate] = useState<Gate>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Already holding a staff session: nothing to ask. (If the cookie behind it has
    // lapsed, the first admin call says so and sends the page back here.)
    if (getAdminRole()) {
      router.replace("/admin");
      return;
    }
    if (sessionLoading) return;

    if (!user || env.dataLayer === "mock") {
      setGate("form");
      return;
    }

    let cancelled = false;
    apiClient
      .get<{ isAdmin: boolean; role: string | null }>("/api/admin/session")
      .then((res) => {
        if (cancelled) return;
        if (res.isAdmin && res.role) {
          saveAdminSession(res.role);
          router.replace("/admin");
          return;
        }
        setGate("denied");
      })
      .catch(() => {
        // The question could not be answered — fall back to asking for credentials
        // rather than refusing someone who may well be staff.
        if (!cancelled) setGate("form");
      });

    return () => {
      cancelled = true;
    };
  }, [user, sessionLoading, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    if (!email || !password) {
      setError("Enter your email and password.");
      setLoading(false);
      return;
    }

    if (env.dataLayer === "api") {
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const json = await res.json();
        if (!res.ok || !json?.data?.identity?.role) throw new Error(json?.error?.message ?? "Sign-in failed");
        saveAdminSession(json.data.identity.role);
        toast.success("Signed in to admin", `${json.data.identity.role.replace("_", " ")} session started.`);
        router.push("/admin");
        return;
      } catch (err) {
        setError((err as Error).message);
        setLoading(false);
        return;
      }
    }

    // Mock mode only. There is no server to ask, so the demo roles stand in.
    if (email === "super@cloudcols.com" && password === "admin") {
      saveAdminSession("super_admin");
    } else {
      saveAdminSession("support");
    }
    toast.success("Signed in to admin");
    router.push("/admin");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo size={34} /></div>

        {gate === "checking" && (
          <Card>
            <CardContent className="flex items-center justify-center gap-3 py-12">
              <Spinner className="h-5 w-5" />
              <span className="text-sm text-muted-foreground">Checking your access…</span>
            </CardContent>
          </Card>
        )}

        {gate === "denied" && (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-error/10 text-error">
                <ShieldX className="h-8 w-8" />
              </span>
              <h2 className="text-lg font-semibold text-foreground">No admin access</h2>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                {user?.email ? <>The account <span className="font-medium text-foreground">{user.email}</span> is not </> : "This account is not "}
                a CloudCols staff account. If that is wrong, ask a super admin to add it.
              </p>
              <div className="mt-6 flex gap-2">
                <Link href="/app"><Button variant="secondary">Back to my files</Button></Link>
                <Button variant="ghost" onClick={() => setGate("form")}>Use other credentials</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {gate === "form" && (
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

              {/* Only where they are actually the credentials. This block was printed
                  unconditionally — publishing a set of admin credentials on the live
                  admin login page, where they do not work but do invite trying. */}
              {env.dataLayer === "mock" && (
                <p className="mt-3 rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">
                  Demo data. <code>super@cloudcols.com</code> / <code>admin</code> for super admin; any other
                  email signs in as support.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
