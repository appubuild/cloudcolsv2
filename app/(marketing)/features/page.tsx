import { FolderOpen, Zap, Share2, Shield, Cloud, Code2 } from "lucide-react";

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">Features</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">Everything you need to store, organize and share your files securely.</p>
      </div>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          { icon: <FolderOpen className="h-6 w-6" />, title: "Automatic organization", desc: "Files are categorized by type into Images, Video, Documents, PDF, Audio and more — so everything is easy to find." },
          { icon: <Zap className="h-6 w-6" />, title: "Direct, fast transfers", desc: "Uploads and streams go straight to object storage via signed URLs. The API never proxies your large files." },
          { icon: <Share2 className="h-6 w-6" />, title: "Granular sharing", desc: "Share files or folders with view/download permissions, expiry dates, and one-click revocation." },
          { icon: <Shield className="h-6 w-6" />, title: "Private by default", desc: "Your data is encrypted and served over short-lived signed URLs. No permanent public links." },
          { icon: <Cloud className="h-6 w-6" />, title: "Universal preview", desc: "Preview images, video, audio and PDFs right in your browser and mobile apps without downloading." },
          { icon: <Code2 className="h-6 w-6" />, title: "Developer API", desc: "A versioned REST API with scoped keys, rate limits, webhooks, and a usage dashboard." },
        ].map((f) => (
          <div key={f.title} className="rounded-lg border border-border bg-surface p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-soft text-primary">{f.icon}</span>
            <h3 className="mt-4 text-lg font-semibold text-foreground">{f.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
