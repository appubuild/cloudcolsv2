"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/store/toast";
import { apiClient } from "@/lib/api/client";

/**
 * Where a reset email's link lands. The token in the link is exchanged server-side;
 * this page only collects the new password.
 */
function ResetInner() {
  const router = useRouter();
  const tokenHash = useSearchParams().get("token_hash") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!tokenHash) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">This link is incomplete</CardTitle>
          <CardDescription>Open the link from the email again, or ask for a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">Send a new reset link</Link>
        </CardContent>
      </Card>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setLoading(true);
    try {
      await apiClient.post("/api/auth/reset-password", { tokenHash, password });
      toast.success("Password changed", "Sign in with your new password. Other devices have been signed out.");
      router.push("/login");
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>You will be signed out everywhere else once it is saved.</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && (
            <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
              {error}{" "}
              {/expired|already used|incomplete/i.test(error) && (
                <Link href="/forgot-password" className="font-medium underline">Get a new link</Link>
              )}
            </p>
          )}
          <Button type="submit" className="w-full" loading={loading}>Save new password</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}
