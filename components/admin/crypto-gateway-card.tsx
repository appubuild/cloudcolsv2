"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Skeleton } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";
import { adminFetch } from "@/lib/api/adminClient";
import { Bitcoin } from "lucide-react";

interface CryptoSettings {
  isEnabled: boolean;
  publicConfig: { destinationAddress?: string; network?: "mainnet" | "testnet"; nodeUrl?: string };
  hasApiKey: boolean;
  hasSecretKey: boolean;
  updatedAt: string | null;
}

/**
 * Paying in XRP through Xaman.
 *
 * The Xaman API key and secret are write-only, like Stripe's: the panel is told whether
 * one is stored and never what it is. Payments are granted only once the transaction is
 * found on the XRP Ledger, so the address here is where the money actually lands — a
 * wrong one takes payments nobody can receive, which is why the server refuses anything
 * that is not a valid ledger address.
 */
export function CryptoGatewayCard() {
  const [settings, setSettings] = useState<CryptoSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState<"mainnet" | "testnet">("testnet");
  const [nodeUrl, setNodeUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const load = async () => {
    try {
      const data = await adminFetch<CryptoSettings>("/api/admin/payment-settings?provider=crypto");
      setSettings(data);
      setAddress(data.publicConfig.destinationAddress ?? "");
      setNetwork(data.publicConfig.network === "mainnet" ? "mainnet" : "testnet");
      setNodeUrl(data.publicConfig.nodeUrl ?? "");
    } catch (e) {
      toast.error("Could not load crypto settings", (e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (patch: { isEnabled?: boolean } = {}) => {
    setSaving(true);
    try {
      const data = await adminFetch<CryptoSettings>("/api/admin/payment-settings?provider=crypto", {
        method: "PUT",
        body: JSON.stringify({
          destinationAddress: address,
          network,
          nodeUrl,
          // Blank means unchanged; the server leaves the stored value alone.
          ...(apiKey ? { apiKey } : {}),
          ...(apiSecret ? { secretKey: apiSecret } : {}),
          ...patch,
        }),
      });
      setSettings(data);
      setApiKey("");
      setApiSecret("");
      toast.success("Crypto settings saved");
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <Skeleton className="h-64 rounded-xl" />;

  const ready = Boolean(settings.publicConfig.destinationAddress) && settings.hasApiKey && settings.hasSecretKey;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bitcoin className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Crypto</CardTitle>
              <CardDescription>XRP through Xaman, verified on the XRP Ledger</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={network === "testnet" ? "warning" : "info"}>{network === "testnet" ? "Testnet" : "Mainnet"}</Badge>
            <Badge tone={settings.isEnabled ? "success" : "muted"}>{settings.isEnabled ? "Enabled" : "Disabled"}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="xrpl-address">Destination address</Label>
            <Input id="xrpl-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="r…" className="font-mono" />
            <p className="text-xs text-muted-foreground">The XRP Ledger account payments are sent to.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xrpl-network">Network</Label>
            <select
              id="xrpl-network"
              value={network}
              onChange={(e) => setNetwork(e.target.value === "mainnet" ? "mainnet" : "testnet")}
              className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground"
            >
              <option value="testnet">Testnet</option>
              <option value="mainnet">Mainnet</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xrpl-node">Verification node (optional)</Label>
            <Input id="xrpl-node" value={nodeUrl} onChange={(e) => setNodeUrl(e.target.value)} placeholder="https://… (a public node if blank)" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xaman-key">Xaman API key {settings.hasApiKey && <span className="text-success">· stored</span>}</Label>
            <Input id="xaman-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings.hasApiKey ? "Leave blank to keep" : ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xaman-secret">Xaman API secret {settings.hasSecretKey && <span className="text-success">· stored</span>}</Label>
            <Input id="xaman-secret" type="password" autoComplete="off" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder={settings.hasSecretKey ? "Leave blank to keep" : ""} />
          </div>
        </div>

        <p className="rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">
          In the Xaman developer console, set the webhook URL to <code className="font-mono">https://cloudcols.com/api/webhooks/xaman</code>.
          A payment is honoured only once its transaction is validated on the ledger — to this address, with the
          reference tag CloudCols issued, for at least the amount quoted. Payments a webhook misses are picked up
          within the hour.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant={settings.isEnabled ? "destructive" : "primary"}
            disabled={saving || (!settings.isEnabled && !ready && !(address && apiKey && apiSecret))}
            onClick={() => void save({ isEnabled: !settings.isEnabled })}
          >
            {settings.isEnabled ? "Disable crypto" : "Enable crypto"}
          </Button>
          <Button loading={saving} onClick={() => void save()}>Save</Button>
        </div>

        {!ready && (
          <p className="text-xs text-warning">
            Crypto cannot be enabled until a destination address, a Xaman API key and a Xaman API secret are stored.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
