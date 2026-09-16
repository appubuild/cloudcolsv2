"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const endpoints = [
  { method: "GET", path: "/v1/files", desc: "List files. Filter by type, folderId or search; sort and page.", scope: "files.read" },
  { method: "GET", path: "/v1/files/:id", desc: "File metadata.", scope: "files.read" },
  { method: "POST", path: "/v1/files/upload", desc: "Request an upload URL. The bytes go straight to storage.", scope: "files.write" },
  { method: "POST", path: "/v1/files/:id/confirm", desc: "Confirm the upload. The file exists only after this.", scope: "files.write" },
  { method: "DELETE", path: "/v1/files/:id", desc: "Move to trash, or ?permanent=true to delete for good.", scope: "files.write" },
  { method: "GET", path: "/v1/files/:id/download-url", desc: "A short-lived URL that saves the file.", scope: "files.read" },
  { method: "GET", path: "/v1/files/:id/preview-url", desc: "A short-lived URL that displays it; ?variant=thumb for the thumbnail.", scope: "files.read" },
  { method: "POST", path: "/v1/files/:id/share", desc: "Create a share link for a file.", scope: "shares.write" },
  { method: "GET", path: "/v1/folders", desc: "List folders; ?parentId= for one level.", scope: "files.read" },
  { method: "GET", path: "/v1/folders/:id", desc: "A folder, its subfolders and its files.", scope: "files.read" },
  { method: "GET", path: "/v1/search", desc: "Search files by name; ?q= is required.", scope: "files.read" },
];

const examples: Record<string, string> = {
  list: `curl -H "Authorization: Bearer $CLOUDCOLS_API_KEY" \\
  "https://cloudcols.com/v1/files?type=image&limit=20"`,
  upload: `# 1. Get an upload ticket
curl -X POST "https://cloudcols.com/v1/files/upload" \\
  -H "Authorization: Bearer $CLOUDCOLS_API_KEY" \\
  -d '{"filename":"photo.jpg","sizeBytes":4096000}'

# 2. PUT bytes directly to the returned presigned URL
curl -X PUT --upload-file photo.jpg "<presigned_url>"`,
  share: `curl -X POST "https://cloudcols.com/v1/files/FILE_ID/share" \\
  -H "Authorization: Bearer $CLOUDCOLS_API_KEY" \\
  -d '{"permission":"download","expiresAt":"2026-12-31T00:00:00Z"}'`,
};

export default function DocsPage() {
  const [tab, setTab] = useState("auth");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">API Documentation</h1>
        <p className="mt-1 text-sm text-muted-foreground">REST API v1. Base URL: <code className="font-mono text-primary">https://cloudcols.com/v1</code></p>
      </div>

      <Tabs
        tabs={[
          { id: "auth", label: "Authentication" },
          { id: "endpoints", label: "Endpoints" },
          { id: "try", label: "Try it" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "auth" && (
        <Card>
          <CardHeader><CardTitle>Authentication</CardTitle><CardDescription>Every request requires an API key.</CardDescription></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Authenticate by sending your key as a Bearer token in the <code className="font-mono">Authorization</code> header. Your key maps
              to exactly one user account server-side; you never pass a user_id yourself.
            </p>
            <CodeBlock code={`Authorization: Bearer cc_live_XXXXXXXXXXX`} />
            <p className="text-muted-foreground">
              Keys are hashed at rest and shown once, when created. A key carries scopes — <code className="font-mono">files.read</code>,{" "}
              <code className="font-mono">files.write</code>, <code className="font-mono">shares.write</code> — and a request outside
              them is refused. Revoke or rotate a key any time from the API Keys page. Limits come from your plan: requests per minute,
              and requests per month.
            </p>
          </CardContent>
        </Card>
      )}

      {tab === "endpoints" && (
        <Card>
          <CardHeader><CardTitle>Endpoints</CardTitle><CardDescription>Versioned under /v1 — we won't break v1 when v2 ships.</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4">Method</th><th className="py-2 pr-4">Path</th><th className="py-2 pr-4">Description</th><th className="py-2">Scope</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((e) => (
                  <tr key={e.method + e.path} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-4"><Badge tone={e.method === "GET" ? "info" : "warning"}>{e.method}</Badge></td>
                    <td className="py-2 pr-4 font-mono text-xs text-foreground">{e.path}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{e.desc}</td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">{e.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === "try" && (
        <Card>
          <CardHeader><CardTitle>Try it</CardTitle><CardDescription>Example requests you can run right away.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">List files</p>
              <CodeBlock code={examples.list} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Upload a file</p>
              <CodeBlock code={examples.upload} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Share a file</p>
              <CodeBlock code={examples.share} />
            </div>
            <p className="text-xs text-muted-foreground">These run against the live API with your own key.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Error codes</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ["429", "RATE_LIMITED", "Too many requests"],
            ["403", "FORBIDDEN", "No permission / missing scope"],
            ["404", "NOT_FOUND", "Resource not found"],
            ["413", "QUOTA_EXCEEDED", "Storage or quota exceeded"],
            ["413", "FILE_TOO_LARGE", "File exceeds plan limit"],
            ["401", "UNAUTHORIZED", "Missing/expired API key"],
          ].map(([code, name, desc]) => (
            <div key={name} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
              <Badge tone="muted">{code}</Badge> <code className="font-mono text-xs text-foreground">{name}</code>
              <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 font-mono text-[13px] leading-relaxed text-foreground">
      {code}
    </pre>
  );
}
