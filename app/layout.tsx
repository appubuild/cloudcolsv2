import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ConfigBridge } from "@/components/config-bridge";
import { RouteTitle } from "@/components/layout/route-title";
import { SessionHydrator } from "@/components/layout/session-hydrator";
import { serverEnv, serverConfig } from "@/lib/config/server-env";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

/**
 * Where relative metadata URLs point.
 *
 * Without this Next resolves them against http://localhost:3000 and says so in a
 * build warning that is easy to miss. The share page's og:image is a relative path,
 * so every social preview in production would have pointed at localhost — the tags
 * would look right in the HTML and fetch nothing anywhere else.
 */
const metadataBase = new URL(
  (serverConfig("NEXT_PUBLIC_APP_URL", "APP_URL") || "https://cloudcols.com").replace(/\/+$/, ""),
);

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: "CloudCols — Cloud Storage & Media Platform",
    template: "%s · CloudCols",
  },
  description:
    "Secure, fast cloud storage for your files, media, and team. Upload, organize, preview and share — with a developer API platform.",
  openGraph: {
    title: "CloudCols",
    description: "Secure cloud storage and media platform.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        {/* Read from the Worker's bindings on the server, so the browser does not
            depend on build-time variables to reach Supabase. */}
        <ConfigBridge supabaseUrl={serverEnv.supabaseUrl} supabaseAnonKey={serverEnv.supabaseAnonKey} />
        {/* Every page needs to know whether someone is signed in — not just the
            ones under /app, which was the only place that ever found out. */}
        <SessionHydrator />
        <RouteTitle />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
