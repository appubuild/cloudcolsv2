"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";

interface Feature {
  icon: string;
  title: string;
  desc: string;
}
interface Landing {
  hero: {
    eyebrow: string;
    title: string;
    accent: string;
    subtitle: string;
    primary: string;
    secondary: string;
  };
  features: Feature[];
  cta: { title: string; subtitle: string; button: string };
  updatedAt: string | null;
}

const EMPTY: Landing = {
  hero: {
    eyebrow: "",
    title: "",
    accent: "",
    subtitle: "",
    primary: "Get started free",
    secondary: "Sign in",
  },
  features: [],
  cta: { title: "", subtitle: "", button: "" },
  updatedAt: null,
};

export function LandingEditor() {
  const [data, setData] = useState<Landing>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content/landing", { cache: "no-store" });
      const json = await res.json();
      setData({ ...EMPTY, ...(json.data ?? {}) } as Landing);
    } catch {
      toast.error("Could not load landing content.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/content/landing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("save failed");
      const json = await res.json();
      setData({ ...EMPTY, ...(json.data ?? {}) } as Landing);
      toast.success("Landing content saved and published.");
    } catch {
      toast.error("Save failed — check your admin session.");
    } finally {
      setSaving(false);
    }
  };

  const patchHero = (k: keyof Landing["hero"], v: string) =>
    setData((d) => ({ ...d, hero: { ...d.hero, [k]: v } }));
  const patchCta = (k: keyof Landing["cta"], v: string) =>
    setData((d) => ({ ...d, cta: { ...d.cta, [k]: v } }));
  const patchFeature = (i: number, k: keyof Feature, v: string) =>
    setData((d) => ({
      ...d,
      features: d.features.map((f, idx) => (idx === i ? { ...f, [k]: v } : f)),
    }));

  if (loading) return <Card><CardContent className="py-8 text-sm text-muted-foreground">Loading landing content…</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Hero section</h2>
            {data.updatedAt && <Badge tone="muted">Updated {new Date(data.updatedAt).toLocaleString()}</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Eyebrow badge</Label>
              <Input value={data.hero.eyebrow} onChange={(e) => patchHero("eyebrow", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Accent word (highlighted)</Label>
              <Input value={data.hero.accent} onChange={(e) => patchHero("accent", e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Title</Label>
              <Input value={data.hero.title} onChange={(e) => patchHero("title", e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Subtitle</Label>
              <Textarea rows={3} value={data.hero.subtitle} onChange={(e) => patchHero("subtitle", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Primary button</Label>
              <Input value={data.hero.primary} onChange={(e) => patchHero("primary", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Secondary button</Label>
              <Input value={data.hero.secondary} onChange={(e) => patchHero("secondary", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Feature grid</h2>
          {data.features.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_2fr]">
              <Input aria-label="icon" value={f.icon} onChange={(e) => patchFeature(i, "icon", e.target.value)} placeholder="icon key" />
              <Input aria-label="title" value={f.title} onChange={(e) => patchFeature(i, "title", e.target.value)} placeholder="Title" />
              <Input aria-label="desc" value={f.desc} onChange={(e) => patchFeature(i, "desc", e.target.value)} placeholder="Description" />
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setData((d) => ({ ...d, features: [...d.features, { icon: "FolderOpen", title: "", desc: "" }] }))}
          >
            Add feature
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Call to action</h2>
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={data.cta.title} onChange={(e) => patchCta("title", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Subtitle</Label>
            <Textarea rows={2} value={data.cta.subtitle} onChange={(e) => patchCta("subtitle", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Button text</Label>
            <Input value={data.cta.button} onChange={(e) => patchCta("button", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>Save & publish</Button>
      </div>
    </div>
  );
}
