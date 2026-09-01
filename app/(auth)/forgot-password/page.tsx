"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/store/toast";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSent(true);
    setLoading(false);
    toast.info("Reset link sent", `If ${email} has an account, a reset link is on its way.`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>We'll email you a link to reset your password.</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        {sent ? (
          <div className="space-y-3">
            <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
              Check your inbox for the reset link.
            </p>
            <Link href="/login" className="block text-center text-sm font-medium text-primary hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
            </div>
            <Button type="submit" className="w-full" loading={loading}>Send reset link</Button>
            <Link href="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
