"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/brand/logo";
import { Toaster } from "@/components/ui/toaster";
import { useMe } from "@/lib/hooks/queries";
import { apiClient } from "@/lib/api/client";
import { toast } from "@/lib/store/toast";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, KeyRound, FileText, Activity, Webhook, CreditCard, ArrowLeft } from "lucide-react";

const devNav = [
  { label: "Dashboard", href: "/developers", icon: LayoutDashboard },
  { label: "API Keys", href: "/developers/api-keys", icon: KeyRound },
  { label: "Docs", href: "/developers/docs", icon: FileText },
  { label: "Usage", href: "/developers/usage", icon: Activity },
  { label: "Webhooks", href: "/developers/webhooks", icon: Webhook },
  { label: "Billing", href: "/developers/billing", icon: CreditCard },
];

export default function DeveloperLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: me, isLoading } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !me) router.push(`/login?returnTo=${encodeURIComponent(pathname)}`);
  }, [isLoading, me, router, pathname]);

  if (isLoading || !me) {
    return (
      <div className="flex h-screen items-center justify-center"><Spinner className="h-7 w-7" /></div>
    );
  }

  const enabled = me.developerEnabled;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link href="/app"><Logo size={26} markOnly /></Link>
            <span className="text-sm font-semibold text-foreground">Developer</span>
          </div>
          <Link href="/app" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to CloudCols
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
        <aside className="hidden w-52 shrink-0 lg:block">
          <nav className="space-y-0.5">
            {devNav.map((item) => {
              const active = item.href === "/developers" ? pathname === "/developers" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                    active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" /> {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          {!enabled ? (
            <EnableCard />
          ) : (
            <>
              <div className="mb-4 flex gap-1.5 overflow-x-auto lg:hidden">
                {devNav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium",
                      pathname.startsWith(item.href) ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted-foreground"
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
              {children}
            </>
          )}
        </div>
      </div>
      <Toaster />
    </div>
  );
}

/**
 * The gate to the Developer portal.
 *
 * It used to call the profile update with developerEnabled: true, a field that update
 * never sent — so pressing it did nothing, and every portal link showed this same card
 * again, which looked like the page had hung.
 */
function EnableCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setBusy(true);
    try {
      await apiClient.post("/api/dev/enable");
      // The portal opens as soon as the account says developer mode is on.
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["developer-plan"] });
      toast.success("Developer mode is on", "You can create an API key now.");
    } catch (e) {
      toast.error("Could not turn on developer mode", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-8 text-center">
      <h1 className="text-xl font-bold text-foreground">Enable developer mode</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Use CloudCols from your own code: create API keys, receive webhooks, and upload, list and share files through
        the API.
      </p>
      <Button className="mt-6" loading={busy} onClick={() => void enable()}>
        Enable developer mode
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        Free to turn on. You start on the free Developer plan, with its own request limits; your storage plan is unchanged.
      </p>
    </div>
  );
}
