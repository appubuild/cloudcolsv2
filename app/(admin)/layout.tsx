"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/store/toast";
import { useAdminSession, clearAdminSession } from "@/lib/store/admin";
import { LayoutDashboard, Users, Database, CreditCard, Wallet, KeyRound, Megaphone, FileText, Shield, Settings, LogOut } from "lucide-react";

const adminNav = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Storage", href: "/admin/storage", icon: Database },
  { label: "Plans", href: "/admin/plans", icon: Settings },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: CreditCard },
  { label: "Payments", href: "/admin/payments", icon: CreditCard },
  { label: "Payment gateways", href: "/admin/payment-gateways", icon: Wallet },
  { label: "Developer API", href: "/admin/api", icon: KeyRound },
  { label: "Ads", href: "/admin/ads", icon: Megaphone },
  { label: "Content", href: "/admin/content", icon: FileText },
  { label: "Security", href: "/admin/security", icon: Shield },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role } = useAdminSession();
  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (!isLogin && !role) router.push("/admin/login");
  }, [role, isLogin, router]);

  if (isLogin) return <>{children}</>;
  if (!role) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Logo size={26} markOnly />
            <span className="text-sm font-semibold text-foreground">Admin</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground capitalize">{role.replace("_", " ")}</span>
          </div>
          <button
            onClick={() => { clearAdminSession(); toast.info("Admin signed out"); router.push("/admin/login"); }}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="space-y-0.5">
            {adminNav.map((item) => {
              const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium", active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")}>
                  <item.icon className="h-4 w-4" /> {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex gap-1.5 overflow-x-auto lg:hidden">
            {adminNav.map((item) => (
              <Link key={item.href} href={item.href} className={cn("shrink-0 rounded-md px-3 py-1.5 text-sm font-medium", pathname.startsWith(item.href) ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted-foreground")}>
                {item.label}
              </Link>
            ))}
          </div>
          {children}
        </div>
      </div>
      <Toaster />
    </div>
  );
}
