"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Skeleton } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";
import { adminFetch } from "@/lib/api/adminClient";
import { CreditCard, Bitcoin, ShieldCheck } from "lucide-react";

interface Settings {
  provider: string;
  isEnabled: boolean;
  testMode: boolean;
  publicConfig: { publishableKey?: string; priceIds?: Record<string, string> };
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  updatedAt: string | null;
}

const PLAN_IDS = ["plan_plus", "plan_pro", "plan_business"] as const;

/**
 * Payment gateway configuration.
 *
 * The secret key and webhook secret are write-only here. They are never sent to
 * this page in any form — not masked, not truncated — because a settings screen
 * that can display a secret leaks it to whoever reaches the endpoint, and admin
 * sessions are what an attacker works hardest to get. The page says whether one is
 * stored; to change it you type a new one.
 */
export default function PaymentGatewaysPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [publishableKey, setPublishableKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [priceIds, setPriceIds] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminFetch<Settings>("/api/admin/payment-settings?provider=stripe");
      setSettings(data);
      setPublishableKey(data.publicConfig.publishableKey ?? "");
      setPriceIds(data.publicConfig.priceIds ?? {});
    } catch (e) {
      toast.error("Could not load payment settings", (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (patch: Partial<Settings> & { secretKey?: string; webhookSecret?: string }) => {
    setSaving(true);
    try {
      const data = await adminFetch<Settings>("/api/admin/payment-settings?provider=stripe", {
        method: "PUT",
        body: JSON.stringify({
          publishableKey,
          priceIds,
          // Blank means unchanged; the server leaves the stored value alone.
          ...(secretKey ? { secretKey } : {}),
          ...(webhookSecret ? { webhookSecret } : {}),
          ...patch,
        }),
      });
      setSettings(data);
      setSecretKey("");
      setWebhookSecret("");
      toast.success("Payment settings saved");
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton className="h-96 rounded-xl" />;

  const ready = settings?.hasSecretKey && settings?.hasWebhookSecret;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payment gateways</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Credentials are encrypted before they are stored and are never sent back to this page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Stripe</CardTitle>
                <CardDescription>Cards and subscriptions</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={settings?.testMode ? "warning" : "info"}>
                {settings?.testMode ? "Test mode" : "Live mode"}
              </Badge>
              <Badge tone={settings?.isEnabled ? "success" : "muted"}>
                {settings?.isEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="pk">Publishable key</Label>
            <Input
              id="pk"
              placeholder="pk_test_…"
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Designed to be public — it ships in page source.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sk">
                Secret key {settings?.hasSecretKey && <Badge tone="success">Stored</Badge>}
              </Label>
              <Input
                id="sk"
                type="password"
                autoComplete="off"
                placeholder={settings?.hasSecretKey ? "Leave blank to keep the current key" : "sk_test_…"}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="whsec">
                Webhook signing secret {settings?.hasWebhookSecret && <Badge tone="success">Stored</Badge>}
              </Label>
              <Input
                id="whsec"
                type="password"
                autoComplete="off"
                placeholder={settings?.hasWebhookSecret ? "Leave blank to keep the current secret" : "whsec_…"}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>

          <div>
            <Label>Price IDs</Label>
            <p className="mb-2 mt-1 text-xs text-muted-foreground">
              Optional. Without them the amount comes from the server&rsquo;s own plan table.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {PLAN_IDS.map((id) => (
                <Input
                  key={id}
                  placeholder={`${id} → price_…`}
                  value={priceIds[id] ?? ""}
                  onChange={(e) => setPriceIds((p) => ({ ...p, [id]: e.target.value }))}
                />
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="flex items-center gap-2 text-xs font-medium text-foreground">
              <ShieldCheck className="h-4 w-4 text-success" /> Webhook endpoint
            </p>
            <code className="mt-1 block text-xs text-muted-foreground">
              {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/stripe
            </code>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Add this in Stripe and subscribe to checkout.session.completed, invoice.paid,
              invoice.payment_failed, customer.subscription.deleted and charge.refunded.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => void save({ testMode: !settings?.testMode })}
              >
                Switch to {settings?.testMode ? "live" : "test"} mode
              </Button>
              <Button
                variant={settings?.isEnabled ? "destructive" : "primary"}
                disabled={saving || (!settings?.isEnabled && !ready && !secretKey && !webhookSecret)}
                onClick={() => void save({ isEnabled: !settings?.isEnabled })}
              >
                {settings?.isEnabled ? "Disable Stripe" : "Enable Stripe"}
              </Button>
            </div>
            <Button loading={saving} onClick={() => void save({})}>
              Save
            </Button>
          </div>

          {!ready && (
            <p className="text-xs text-warning">
              Stripe cannot be enabled until both a secret key and a webhook signing secret are
              stored — without the signing secret nothing can be verified, so a payment could be
              taken for a plan that would never activate.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted-foreground/10 text-muted-foreground">
              <Bitcoin className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Crypto</CardTitle>
              <CardDescription>Xaman / XRPL — not connected yet</CardDescription>
            </div>
            <Badge tone="muted" className="ml-auto">Coming soon</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The payment layer takes providers as adapters, so crypto is a file to add rather than a
            change to how plans work. Nothing here accepts payment until that adapter exists.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
