"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryThumb } from "@/components/files/category-thumb";
import { Spinner } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";
import { shareRepo } from "@/lib/repositories";
import { formatBytes, formatDate } from "@/lib/utils";
import { FileText, Download, Timer, XCircle, ShieldAlert, Link2 } from "lucide-react";
import type { File, Folder, ShareLink } from "@/lib/types";

type State =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "revoked" }
  | { kind: "expired" }
  | { kind: "ready"; share: ShareLink; file: File | null; folder: Folder | null };

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) return;
    shareRepo
      .resolve(token)
      .then((res) => {
        if (!res) return setState({ kind: "not_found" });
        setState({ kind: "ready", share: res.share, file: res.file, folder: res.folder });
      })
      .catch((e) => {
        const code = (e as { code?: string }).code;
        if (code === "SHARE_EXPIRED") setState({ kind: "expired" });
        else if (code === "SHARE_REVOKED") setState({ kind: "revoked" });
        else setState({ kind: "not_found" });
      });
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <Link href="/"><Logo size={28} /></Link>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">Sign in</Link>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        {state.kind === "loading" && <Spinner className="h-7 w-7" />}
        {state.kind === "not_found" && (
          <StateCard icon={<Link2 className="h-8 w-8" />} title="This link is not available" desc="It may have been removed by the owner." />
        )}
        {state.kind === "revoked" && (
          <StateCard icon={<ShieldAlert className="h-8 w-8" />} title="This link is no longer available" desc="The owner revoked access." />
        )}
        {state.kind === "expired" && (
          <StateCard icon={<Timer className="h-8 w-8" />} title="This link has expired" desc="Ask the owner to share again." />
        )}
        {state.kind === "ready" && <SharedContent state={state} />}
      </main>
    </div>
  );
}

function StateCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card className="max-w-sm">
      <CardContent className="flex flex-col items-center py-12 text-center">
        <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">{icon}</span>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

function SharedContent({ state }: { state: Extract<State, { kind: "ready" }> }) {
  const { share, file } = state;
  const name = file?.originalFilename ?? state.folder?.name ?? "Folder";

  return (
    <Card className="w-full max-w-md">
      <CardContent className="py-10 text-center">
        {file ? (
          <CategoryThumb category={file.category} className="mx-auto mb-4 h-14 w-14" />
        ) : (
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-primary-soft text-primary"><FileText className="h-6 w-6" /></span>
        )}
        <h2 className="text-lg font-semibold text-foreground">{name}</h2>
        {file && (
          <p className="mt-1 text-sm text-muted-foreground">
            {file.category} · {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Shared by CloudCols user · {share.permission === "download" ? "Download allowed" : "View only"}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="secondary">
            <Download className="h-4 w-4" /> {share.permission === "download" ? "Download" : "Preview"}
          </Button>
          <Button variant="ghost" onClick={() => toast.info("Copying link", "Link copied.")}>Copy link</Button>
        </div>
      </CardContent>
    </Card>
  );
}
