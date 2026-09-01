import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Logo } from "@/components/brand/logo";
import { Cloud, Shield, FolderOpen, Share2, Zap, Code2 } from "lucide-react";
import { getLanding, DEFAULT_LANDING } from "@/lib/content/landing";

// Landing content is CMS-editable at runtime, so the page must render on
// demand (not be statically prerendered with build-time defaults).
export const dynamic = "force-dynamic";

// Map a saved icon key to its lucide component (fallback to FolderOpen).
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  FolderOpen,
  Zap,
  Share2,
  Shield,
  Cloud,
  Code2,
};

export default async function HomePage() {
  // Read CMS-configured landing content; fall back to defaults if unset or if
  // the DB isn't configured (mock/local dev).
  let landing = DEFAULT_LANDING;
  try {
    landing = await getLanding();
  } catch {
    landing = DEFAULT_LANDING;
  }

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center md:py-28">
          {landing.hero.eyebrow && (
            <Badge tone="info" className="mx-auto mb-5">{landing.hero.eyebrow}</Badge>
          )}
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-foreground md:text-6xl">
            {landing.hero.title.split(landing.hero.accent)[0]}
            {landing.hero.accent && <span className="text-primary">{landing.hero.accent}</span>}
            {landing.hero.title.split(landing.hero.accent)[1] ?? ""}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            {landing.hero.subtitle}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/register"><Button size="lg">{landing.hero.primary}</Button></Link>
            <Link href="/login"><Button size="lg" variant="secondary">{landing.hero.secondary}</Button></Link>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-4 md:grid-cols-3">
          {landing.features.map((f) => {
            const Icon = ICONS[f.icon] ?? FolderOpen;
            return (
              <div key={f.title} className="rounded-lg border border-border bg-surface p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon className="h-6 w-6" /></span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h2 className="text-3xl font-bold text-foreground">{landing.cta.title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {landing.cta.subtitle}
          </p>
          <Link href="/register" className="mt-6 inline-block"><Button size="lg">{landing.cta.button}</Button></Link>
        </div>
      </section>
    </div>
  );
}
