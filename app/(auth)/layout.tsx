import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Toaster } from "@/components/ui/toaster";
import { Suspense } from "react";
import { SignedInGate } from "@/components/layout/signed-in-gate";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link href="/">
            <Logo size={34} />
          </Link>
        </div>
        {/* useSearchParams needs a Suspense boundary in the App Router. */}
        <Suspense fallback={null}>
          <SignedInGate />
        </Suspense>
        {children}
        <Toaster />
      </div>
    </div>
  );
}
