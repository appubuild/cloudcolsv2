"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/lib/store/toast";
import { adminFetch } from "@/lib/api/adminClient";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { timeAgo } from "@/lib/utils";
import { ExternalLink, Plus, Trash2 } from "lucide-react";

/**
 * Pages: content an admin writes and the site serves at /p/<slug>.
 *
 * The HTML is sanitised on the server before it is stored, not when it is rendered —
 * so what is in the database is already safe to put on a page, and no reader has to
 * remember to ask. Anything the editor can produce survives; a script tag does not.
 */

interface CmsPage {
  slug: string;
  title: string;
  html: string;
  description: string;
  published: boolean;
  indexable: boolean;
  updatedAt: string | null;
}

const BLANK: CmsPage = {
  slug: "",
  title: "",
  html: "<p></p>",
  description: "",
  published: false,
  indexable: true,
  updatedAt: null,
};

export default function AdminPagesPage() {
  const [pages, setPages] = useState<CmsPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CmsPage | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CmsPage | null>(null);

  const load = useCallback(() => {
    adminFetch<CmsPage[]>("/api/admin/pages")
      .then((rows) => {
        setPages(rows);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      toast.error("A title is required");
      return;
    }
    setSaving(true);
    try {
      const saved = await adminFetch<CmsPage>("/api/admin/pages", {
        method: "PUT",
        body: JSON.stringify({
          slug: editing.slug || undefined,
          title: editing.title,
          html: editing.html,
          description: editing.description,
          published: editing.published,
          indexable: editing.indexable,
        }),
      });
      toast.success(
        saved.published ? "Page published" : "Draft saved",
        saved.published ? `Live at /p/${saved.slug}` : "Not visible to anyone yet.",
      );
      setEditing(null);
      setIsNew(false);
      load();
    } catch (e) {
      toast.error("Could not save the page", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await adminFetch(`/api/admin/pages?slug=${encodeURIComponent(confirmDelete.slug)}`, { method: "DELETE" });
      toast.success("Page deleted", `/p/${confirmDelete.slug} is gone.`);
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error("Could not delete", (e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Content served at <code className="font-mono text-xs">/p/&lt;address&gt;</code>. Drafts are visible to nobody.
          </p>
        </div>
        <Button onClick={() => { setEditing({ ...BLANK }); setIsNew(true); }}>
          <Plus className="h-4 w-4" /> New page
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-foreground">Could not load pages</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!pages && !error && (
        <Card><CardContent className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</CardContent></Card>
      )}

      {pages && pages.length === 0 && !error && (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-foreground">No pages yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A page is a title, a web address and some content — useful for terms, privacy, help or an announcement.
            </p>
          </CardContent>
        </Card>
      )}

      {pages && pages.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {pages.map((p) => (
                <div key={p.slug} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => { setEditing(p); setIsNew(false); }}
                  >
                    <p className="truncate text-sm font-medium text-foreground">{p.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      /p/{p.slug}
                      {p.updatedAt ? ` · edited ${timeAgo(p.updatedAt)}` : ""}
                    </p>
                  </button>
                  <Badge tone={p.published ? "success" : "muted"}>{p.published ? "Published" : "Draft"}</Badge>
                  {p.published && !p.indexable && <Badge tone="muted">noindex</Badge>}
                  {p.published && (
                    <a href={`/p/${p.slug}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={`Open /p/${p.slug}`}>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                  <Button variant="ghost" size="sm" aria-label={`Delete ${p.title}`} onClick={() => setConfirmDelete(p)}>
                    <Trash2 className="h-4 w-4 text-error" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{isNew ? "New page" : `Editing ${editing.title}`}</CardTitle>
            <CardDescription>
              {editing.slug ? <>Will be served at <code className="font-mono text-xs">/p/{editing.slug}</code></> : "The address is made from the title unless you set one."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Terms of service" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slug">Web address</Label>
                <Input
                  id="slug"
                  value={editing.slug}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                  placeholder="terms-of-service"
                  // Changing it after publishing moves the page and breaks any link to
                  // the old address, so say so rather than letting it be discovered.
                  disabled={!isNew}
                />
                {!isNew && <p className="text-xs text-muted-foreground">Fixed once created — changing it would break existing links.</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Search description</Label>
              <Input
                id="description"
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="Left blank, the first line of the page is used."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Content</Label>
              <RichTextEditor value={editing.html} onChange={(html) => setEditing({ ...editing, html })} />
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <Toggle
                label="Published"
                hint="A draft returns a not-found page to everyone, including you."
                value={editing.published}
                onChange={(v) => setEditing({ ...editing, published: v })}
              />
              <Toggle
                label="Allow search engines to index it"
                hint="Turn off for pages meant to be linked to directly."
                value={editing.indexable}
                onChange={(v) => setEditing({ ...editing, indexable: v })}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setEditing(null); setIsNew(false); }} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editing.published ? "Save & publish" : "Save draft"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {confirmDelete && (
        <Dialog open onClose={() => setConfirmDelete(null)} title="Delete page">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{confirmDelete.title}</span> and its content will be
              removed. Anyone following a link to <code className="font-mono text-xs">/p/{confirmDelete.slug}</code> will
              get a not-found page.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={remove}>Delete</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${value ? "bg-primary" : "bg-border"}`}
      >
        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${value ? "translate-x-4" : ""}`} />
      </button>
    </div>
  );
}
