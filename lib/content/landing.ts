import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/// Default landing content, used when nothing has been saved yet. Kept in sync
/// with the hardcoded marketing copy so the page never looks empty.
export const DEFAULT_LANDING = {
  hero: {
    eyebrow: "Now with a developer API platform",
    title: "Your files. Secure. Everywhere.",
    accent: "Secure.",
    subtitle:
      "CloudCols is a fast, private cloud for your photos, videos, documents, and more. Preview, share, and access from any device — with 5 GB free to start.",
    primary: "Get started free",
    secondary: "Sign in",
  },
  features: [
    { icon: "FolderOpen", title: "Everything organized", desc: "Automatic categorization of images, video, documents, PDFs, and archives." },
    { icon: "Zap", title: "Fast by design", desc: "Direct uploads and streaming from the edge — never proxied through slow servers." },
    { icon: "Share2", title: "Secure sharing", desc: "Share links with view/download permissions, expiry, and instant revocation." },
    { icon: "Shield", title: "Private by default", desc: "Your files are encrypted and private. Sensitive data never leaves your control." },
    { icon: "Cloud", title: "Preview everything", desc: "Images, video, audio and PDF preview right in your browser and apps." },
    { icon: "Code2", title: "Developer API", desc: "Upload, search and share programmatically with a versioned REST API." },
  ] as Array<{ icon: string; title: string; desc: string }>,
  cta: {
    title: "Start storing on CloudCols",
    subtitle: "Create a free account and get 5 GB of secure cloud storage in seconds.",
    button: "Create your free account",
  },
  updatedAt: null as string | null,
};

export type Landing = typeof DEFAULT_LANDING;

export function mergeDefaults(partial: Partial<Landing> | null): Landing {
  const base = JSON.parse(JSON.stringify(DEFAULT_LANDING)) as Landing;
  const p = (partial ?? {}) as Record<string, unknown>;
  for (const k of ["hero", "features", "cta", "updatedAt"] as const) {
    if (p[k] != null) (base as Record<string, unknown>)[k] = p[k];
  }
  return base;
}

/// Server-side read of the landing content (defaults if not saved).
export async function getLanding(): Promise<Landing> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("site_content")
    .select("content, updated_at")
    .eq("key", "landing")
    .maybeSingle();
  if (!data) return mergeDefaults(null);
  const content = (data.content ?? {}) as Partial<Landing>;
  return mergeDefaults({ ...content, updatedAt: data.updated_at ?? null });
}
