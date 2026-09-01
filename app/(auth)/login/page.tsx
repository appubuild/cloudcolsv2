"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { authRepo } from "@/lib/repositories";
import { toast } from "@/lib/store/toast";
import { useAuthStore } from "@/lib/store/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Suspense } from "react";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get("returnTo") ?? "/app";
  const setUser = useAuthStore((s) => s.setUser);
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await authRepo.signIn(email, password);
      setUser(user);
      await qc.invalidateQueries();
      toast.success("Welcome back", `Signed in as ${user.name}.`);
      router.push(returnTo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Access your CloudCols files and media.</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <form onSubmit={submit} className="space-y-4">
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
        <div className="mt-4 rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Demo account</p>
          <p>Email: <code className="text-primary">demo@cloudcols.com</code> · Password: <code className="text-primary">demo1234</code></p>
        </div>
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
