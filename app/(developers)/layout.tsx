"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/brand/logo";
import { Toaster } from "@/components/ui/toaster";
import { useMe } from "@/lib/hooks/queries";
import { authRepo } from "@/lib/repositories";
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

function EnableCard() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const router = useRouter();

  return (
    <div className="rounded-lg border border-border bg-surface p-8 text-center">
      <h1 className="text-xl font-bold text-foreground">Enable developer mode</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        The Developer API is a separate product with its own plans, billing and rate limits. Enable it on your account to
        create API keys, use webhooks, and access the platform programmatically.
      </p>
      <Button
        className="mt-6"
        onClick={async () => {
          if (!me) return;
          await authRepo.updateProfile(me.id, { developerEnabled: true });
          await qc.invalidateQueries();
        }}
      >
        Enable developer mode
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">This is a demo — enabling simulates the real flow.</p>
    </div>
  );
}
