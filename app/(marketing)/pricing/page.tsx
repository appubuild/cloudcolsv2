"use client";

import Link from "next/link";
import { usePlans } from "@/lib/hooks/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Check, Sparkles } from "lucide-react";

export default function PricingPage() {
  const { data: plans, isLoading } = usePlans();
  const highlighted = plans?.find((p) => p.id === "plan_pro");

  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">Simple, transparent pricing</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Start free, upgrade when you need more. Plans are configurable and shown live from the platform.
        </p>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)
          : (plans ?? []).map((p) => {
              const isHighlight = p.id === highlighted?.id;
              return (
                <Card key={p.id} className={`relative ${isHighlight ? "border-primary shadow-elevated" : ""}`}>
                  {isHighlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-white">
                      <Sparkles className="mr-1 inline h-3 w-3" /> Most popular
                    </span>
                  )}
                  <CardContent className="flex flex-col pt-6">
                    <div className="flex items-center justify-between">
                      <p className="text-lg font-semibold text-foreground">{p.name}</p>
                      {p.id === "plan_free" && <Badge tone="muted">Free forever</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{p.tagline}</p>
                    <p className="mt-4 text-3xl font-bold text-foreground">
                      {p.priceCents === 0 ? "Free" : `$${(p.priceCents / 100).toFixed(2)}`}
                      {p.billingInterval && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                    </p>
                    <ul className="mt-5 flex-1 space-y-2 text-sm text-muted-foreground">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {f}
                        </li>
                      ))}
                    </ul>
                    <Link href={p.id === "plan_free" ? "/register" : "/register?plan=paid"} className="mt-6">
                      <Button className="w-full" variant={isHighlight ? "primary" : "secondary"}>
                        Get {p.name}
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      <div className="mt-12 rounded-lg border border-border bg-surface p-6 text-center">
        <h2 className="text-lg font-semibold text-foreground">Developer API plans</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The Developer API is a separate product with its own plans and billing. Explore it from the Developer portal.
        </p>
        <Link href="/developers" className="mt-4 inline-block">
          <Button variant="outline">View developer pricing</Button>
        </Link>
      </div>
    </div>
  );
}
