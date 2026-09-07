import type { MetadataRoute } from "next";
import { serverConfig } from "@/lib/config/server-env";

export const dynamic = "force-dynamic";

/**
 * The pages worth indexing: the public marketing site, and nothing else.
 *
 * Deliberately hand-listed rather than crawled from the route tree. Everything else
 * this app serves is either behind a session or addressed by a token, and a sitemap
 * that enumerated share links would be the opposite of what those are for.
 */
const PUBLIC_PATHS = ["", "/features", "/pricing", "/security", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (serverConfig("NEXT_PUBLIC_APP_URL", "APP_URL") || "https://cloudcols.com").replace(/\/+$/, "");
  const lastModified = new Date();

  return PUBLIC_PATHS.map((path) => ({
    url: `${base}${path}`,
    lastModified,
    changeFrequency: path === "" ? ("weekly" as const) : ("monthly" as const),
    priority: path === "" ? 1 : 0.7,
  }));
}
