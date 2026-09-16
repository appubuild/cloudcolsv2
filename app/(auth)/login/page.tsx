"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { authRepo, useApi } from "@/lib/repositories";
import { apiClient, hasSessionHint, MfaRequiredError } from "@/lib/api/client";
import { toast } from "@/lib/store/toast";
import { useAuthStore } from "@/lib/store/auth";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Sign-in, in up to two steps.
 *
 * The password step always comes first. For an account with two-factor authentication
 * on, a correct password yields a session that can do nothing yet, and this page asks
 * for the authenticator code (or, for a lost phone, a recovery code) to complete it.
 * A reload in the middle comes back to the code step: the half-finished session is in
 * the cookies, and the server says it is still owed a code.
 */
type Step = "password" | "code" | "recovery";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get("returnTo") ?? "/app";
  const setUser = useAuthStore((s) => s.setUser);
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // /auth/confirm sends a one-time link that has expired or was already used back here.
  const [error, setError] = useState<string | null>(
    params.get("error") === "link" ? "That sign-in link has expired or was already used. Sign in below, or ask for a new link." : null,
  );
  const [loading, setLoading] = useState(false);

  // A session that passed the password but not the code, from before a reload.
  useEffect(() => {
    if (!useApi || !hasSessionHint()) return;
    apiClient
      .get<{ pending: boolean }>("/api/auth/mfa")
      .then((s) => {
        if (s.pending) setStep("code");
      })
      .catch(() => undefined);
  }, []);

  const finish = async () => {
    const user = await authRepo.getCurrentUser();
    if (!user) throw new Error("Signing in did not complete. Try again.");
    setUser(user);
    await qc.invalidateQueries();
    toast.success("Welcome back", `Signed in as ${user.name}.`);
    router.push(returnTo);
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setLoading(true);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        const user = await authRepo.signIn(email, password);
        setUser(user);
        await qc.invalidateQueries();
        toast.success("Welcome back", `Signed in as ${user.name}.`);
        router.push(returnTo);
      } catch (err) {
        if (err instanceof MfaRequiredError) {
          setCode("");
          setStep("code");
          return;
        }
        throw err;
      }
    });
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (step === "code") {
        await apiClient.post("/api/auth/mfa/verify", { code });
      } else {
        await apiClient.post("/api/auth/mfa/recover", { code });
        toast.info("Two-factor authentication was turned off", "Set it up again in Settings with your new device.");
      }
      await finish();
    });
  };

  const cancel = () => {
    void authRepo.signOut().then(() => {
      setStep("password");
      setCode("");
      setError(null);
    });
  };

  if (step !== "password") {
    const recovery = step === "recovery";
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{recovery ? "Use a recovery code" : "Enter your code"}</CardTitle>
          <CardDescription>
            {recovery
              ? "One of the codes you saved when you turned on two-factor authentication. Using one turns 2FA off, so you can set it up again."
              : "Open your authenticator app and enter the 6-digit code for CloudCols."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <form onSubmit={submitCode} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="code">{recovery ? "Recovery code" : "Code"}</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/[^\d ]/g, ""))}
                inputMode={recovery ? "text" : "numeric"}
                autoComplete={recovery ? "off" : "one-time-code"}
                placeholder={recovery ? "xxxxx-xxxxx" : "123 456"}
                className="font-mono tracking-widest"
                required
                autoFocus
              />
            </div>
            {error && <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}
            <Button type="submit" className="w-full" loading={loading}>{recovery ? "Use recovery code" : "Verify"}</Button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => { setStep(recovery ? "code" : "recovery"); setCode(""); setError(null); }}
            >
              {recovery ? "Use my authenticator app" : "Lost your phone? Use a recovery code"}
            </button>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={cancel}>Cancel</button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Access your CloudCols files and media.</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <form onSubmit={submitPassword} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
            </div>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {error && <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>Sign in</Button>
        </form>
        {/* Only meaningful against mock data — that account exists nowhere else.
            Shown on a real deployment it is an invitation to try credentials that
            cannot work, on a sign-in form that is otherwise real. */}
        {!useApi && (
          <div className="mt-4 rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Demo account</p>
            <p>Email: <code className="text-primary">demo@cloudcols.com</code> · Password: <code className="text-primary">demo1234</code></p>
          </div>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          New to CloudCols? <Link href="/register" className="font-medium text-primary hover:underline">Create an account</Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
