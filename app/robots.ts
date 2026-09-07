import type { MetadataRoute } from "next";
import { serverConfig } from "@/lib/config/server-env";

export const dynamic = "force-dynamic";

/**
 * What crawlers may index.
 *
 * The marketing pages are the product's public face and should be found. Nothing
 * else should: /app and /admin need a session and would only ever yield a login
 * page, /api returns JSON, and /s/ links are meant to be opened by the person they
 * were sent to. Share pages carry their own noindex as well — a crawler that
 * ignores robots.txt still reads meta tags.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (serverConfig("NEXT_PUBLIC_APP_URL", "APP_URL") || "https://cloudcols.com").replace(/\/+$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app/", "/admin/", "/api/", "/s/", "/developers/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
