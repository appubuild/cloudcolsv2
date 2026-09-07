"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth";
import { ArrowRight } from "lucide-react";

/**
 * The landing page's call to action, for whoever is actually looking at it.
 *
 * "Get started free" and "Sign in" are the right offer for a visitor and a dead end
 * for a customer — they click, land on a form for something that already happened,
 * and have to find their own way back. Someone with a session is offered their files
 * instead.
 *
 * Renders a fixed-height gap while the session is being read rather than guessing.
 * A hero button that changes what it says a moment after the page appears is worse
 * than one that arrives slightly late.
 */
export function HeroCta({ primaryLabel, secondaryLabel }: { primaryLabel: string; secondaryLabel: string }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  if (loading) return <div className="h-12" aria-hidden />;

  if (user) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/app">
          <Button size="lg">
            Dashboard <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/app/storage">
          <Button size="lg" variant="secondary">Storage &amp; plans</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Link href="/register"><Button size="lg">{primaryLabel}</Button></Link>
      <Link href="/login"><Button size="lg" variant="secondary">{secondaryLabel}</Button></Link>
    </div>
  );
}
