import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { AccountNav } from "@/components/layout/account-nav";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/"><Logo size={30} /></Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <Link href="/features" className="hover:text-foreground">Features</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/security" className="hover:text-foreground">Security</Link>
            <Link href="/developers" className="hover:text-foreground">Developers</Link>
          </nav>
          <div className="flex items-center gap-2">
            <AccountNav />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Logo size={28} />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Secure, fast cloud storage for your files and media. Built for individuals, creators, and teams.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link href="/features" className="hover:text-foreground">Features</Link></li>
              <li><Link href="/pricing" className="hover:text-foreground">Pricing</Link></li>
              <li><Link href="/developers" className="hover:text-foreground">Developer API</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Legal</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link href="/privacy" className="hover:text-foreground">Privacy</Link></li>
              <li><Link href="/terms" className="hover:text-foreground">Terms</Link></li>
              <li><Link href="/security" className="hover:text-foreground">Security</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border py-5 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} CloudCols. All rights reserved.
        </div>
      </footer>
      <Toaster />
    </div>
  );
}
