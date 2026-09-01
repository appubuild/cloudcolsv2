/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the app to load in the Arena sandbox preview iframe and on any host,
  // so the dev server does not reject the preview origin.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Keep file-based routing predictable for the catch-all folder route.
    typedRoutes: false,
  },
  images: {
    // Thumbnails and other derivative assets are served from the object storage
    // CDN in production. Allow arbitrary remote hosts so seed thumbnails render.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  // HTTP cache headers. Assets with hashed filenames are immutable; pages and
  // the (mock) data are revalidated by the browser as needed.
  async headers() {
    // Security headers applied to every route (defense-in-depth).
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-DNS-Prefetch-Control", value: "on" },
    ];
    // Content-Security-Policy in production only (kept off in dev/preview so the
    // sandboxed preview iframe and HMR keep working). A strict nonce-based CSP is
    // a good follow-up when deploying behind a proxy that can rewrite scripts.
    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob: https:; " +
          "font-src 'self' data:; " +
          "connect-src 'self' https:; " +
          "frame-ancestors 'none'; " +
          "base-uri 'self'",
      });
    }
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "cache-control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/favicon.ico",
        headers: [{ key: "cache-control", value: "public, max-age=604800" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "cache-control", value: "no-store" }],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
