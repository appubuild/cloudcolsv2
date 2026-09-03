import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ConfigBridge } from "@/components/config-bridge";
import { serverEnv } from "@/lib/config/server-env";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
