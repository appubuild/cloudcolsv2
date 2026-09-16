"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";
import { apiClient } from "@/lib/api/client";

interface Status {
  enabled: boolean;
  pending: boolean;
  recoveryCodesLeft: number;
}

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

type Confirming = "disable" | "regenerate" | null;

/**
 * Two-factor authentication with an authenticator app.
 *
 * Setting it up is two steps — scan, then type the first code — and only the second
 * switches it on, so a QR code scanned into nothing cannot lock anyone out. The recovery
 * codes are shown once, straight after, because that is the moment they can be saved.
 */
export function TwoFactorCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiClient
      .get<Status>("/api/auth/mfa")
      .then(setStatus)
      .catch(() => setStatus(null));

  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(failure, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      setEnrollment(await apiClient.post<Enrollment>("/api/auth/mfa/enroll"));
      setCode("");
    }, "Could not start setup");

  const activate = () =>
    run(async () => {
      if (!enrollment) return;
      const r = await apiClient.post<{ recoveryCodes: string[] }>("/api/auth/mfa/activate", {
        factorId: enrollment.factorId,
        code,
      });
      setEnrollment(null);
      setCode("");
      setCodes(r.recoveryCodes);
      await load();
      toast.success("Two-factor authentication is on");
    }, "That did not work");

  const confirm = () =>
    run(async () => {
      if (confirming === "disable") {
        await apiClient.post("/api/auth/mfa/disable", { code });
        toast.success("Two-factor authentication is off");
      } else if (confirming === "regenerate") {
        const r = await apiClient.post<{ recoveryCodes: string[] }>("/api/auth/mfa/recovery-codes", { code });
        setCodes(r.recoveryCodes);
      }
      setConfirming(null);
      setCode("");
      await load();
    }, "That did not work");

  const copyCodes = async () => {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Could not copy", "Select the codes and copy them by hand.");
    }
  };

  const downloadCodes = () => {
    if (!codes) return;
    const text = `CloudCols recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "cloudcols-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const codeInput = (id: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>6-digit code from your app</Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
        placeholder="123 456"
        className="max-w-[10rem] font-mono tracking-widest"
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Two-factor authentication</CardTitle>
            <CardDescription>A code from an authenticator app, as well as your password, to sign in.</CardDescription>
          </div>
          {status && <Badge tone={status.enabled ? "success" : "muted"}>{status.enabled ? "On" : "Off"}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {codes && (
          <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
            <p className="text-sm font-medium text-foreground">Save your recovery codes</p>
            <p className="text-xs text-muted-foreground">
              If you lose your phone, one of these gets you back in. Each works once. This is the only time they are shown.
            </p>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-foreground">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={copyCodes}>Copy</Button>
              <Button variant="secondary" onClick={downloadCodes}>Download</Button>
              <Button onClick={() => setCodes(null)}>I have saved them</Button>
            </div>
          </div>
        )}

        {!status && <p className="text-sm text-muted-foreground">Loading…</p>}

        {status && !status.enabled && !enrollment && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Works with Google Authenticator, Microsoft Authenticator, 1Password, Authy and similar apps.
            </p>
            <Button onClick={start} loading={busy}>Set up</Button>
          </div>
        )}

        {enrollment && (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Open your authenticator app and scan this code.</li>
              <li>Type the 6-digit code it shows, to finish.</li>
            </ol>
            <div className="flex flex-wrap items-start gap-6">
              {/* An SVG data URL from Supabase Auth; data: images are allowed by the CSP. */}
              <img src={enrollment.qrCode} alt="QR code for your authenticator app" className="h-44 w-44 rounded-md bg-white p-2" />
              <div className="min-w-0 space-y-2">
                <p className="text-xs text-muted-foreground">Can&apos;t scan? Enter this key in the app instead:</p>
                <code className="block break-all rounded bg-surface-2 px-2 py-1 font-mono text-xs text-foreground">{enrollment.secret}</code>
              </div>
            </div>
            {codeInput("mfa-activate")}
            <div className="flex gap-2">
              <Button onClick={activate} loading={busy} disabled={code.replace(/\s/g, "").length !== 6}>Turn on</Button>
              <Button variant="ghost" onClick={() => { setEnrollment(null); setCode(""); }}>Cancel</Button>
            </div>
          </div>
        )}

        {status?.enabled && !confirming && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? "" : "s"} left.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setConfirming("regenerate"); setCode(""); }}>New recovery codes</Button>
              <Button variant="destructive" onClick={() => { setConfirming("disable"); setCode(""); }}>Turn off</Button>
            </div>
          </div>
        )}

        {confirming && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {confirming === "disable"
                ? "Enter a current code to turn two-factor authentication off."
                : "Enter a current code. Your old recovery codes will stop working."}
            </p>
            {codeInput("mfa-confirm")}
            <div className="flex gap-2">
              <Button
                variant={confirming === "disable" ? "destructive" : "primary"}
                onClick={confirm}
                loading={busy}
                disabled={code.replace(/\s/g, "").length !== 6}
              >
                {confirming === "disable" ? "Turn off" : "Replace codes"}
              </Button>
              <Button variant="ghost" onClick={() => { setConfirming(null); setCode(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
