"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { toast } from "@/lib/store/toast";
import { apiClient } from "@/lib/api/client";
import { refreshFileViews } from "@/lib/query-client";
import { extensionOf } from "@/lib/services/fileTypes";
import { Eye, Pencil, Save, RotateCcw } from "lucide-react";
import type { File as CloudFile } from "@/lib/types";

/**
 * Reading and editing a text file.
 *
 * The bytes are fetched from the signed URL directly, not proxied — a save is an
 * upload, and uploads do not travel through our compute. The disposition on that URL
 * is irrelevant to `fetch`; it only decides what a browser navigation would do.
 *
 * Markdown and HTML get a rendered view as well as the source. The HTML preview is
 * deliberately an iframe with `sandbox` and no `allow-scripts`: this is somebody's
 * stored file, it can contain anything, and rendering it in the app's own document
 * would be handing it the app's origin.
 */
type Mode = "source" | "rendered";

export function TextEditor({ file, url, startEditing = false }: { file: CloudFile; url: string; startEditing?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(startEditing);
  const [mode, setMode] = useState<Mode>("source");

  const ext = extensionOf(file.originalFilename);
  const isMarkdown = ext === "md" || ext === "markdown";
  const isHtml = ext === "html" || ext === "htm" || ext === "xhtml";
  const canRender = isMarkdown || isHtml;

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Storage answered ${r.status}.`);
        return r.text();
      })
      .then((t) => {
        if (cancelled) return;
        setText(t);
        setOriginal(t);
        // Opened to edit: show the source, not a rendered view of it.
        setMode(canRender && !startEditing ? "rendered" : "source");
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [url, canRender, startEditing]);

  const dirty = text !== null && text !== original;

  const save = useCallback(async () => {
    if (text === null) return;
    setSaving(true);
    try {
      const bytes = new TextEncoder().encode(text);
      const ticket = await apiClient.post<{ presignedUrl: string; maxBytes: number }>(
        `/api/files/${file.id}/content`,
        { sizeBytes: bytes.byteLength },
      );

      const put = await fetch(ticket.presignedUrl, { method: "PUT", body: bytes });
      if (!put.ok) throw new Error(`Storage rejected the save (HTTP ${put.status}).`);

      // Confirmed separately: the server asks storage what actually landed rather
      // than recording what the browser said it sent.
      await apiClient.put(`/api/files/${file.id}/content`, {});

      setOriginal(text);
      refreshFileViews();
      toast.success("Saved", `${file.originalFilename} updated.`);
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [text, file.id, file.originalFilename]);

  // Ctrl/Cmd+S, because anyone editing text will try it.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && editing) {
        e.preventDefault();
        if (dirty && !saving) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, dirty, saving, save]);

  if (error) {
    return (
      <div className="text-center text-white/70">
        <p className="text-sm font-medium">{file.originalFilename}</p>
        <p className="mt-2 text-xs">Could not read this file. {error}</p>
      </div>
    );
  }
  if (text === null) return <Spinner className="h-8 w-8" />;

  return (
    <div ref={boxRef} className="flex h-full w-full max-w-4xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {canRender && !editing && (
          <div className="flex overflow-hidden rounded-md border border-white/20">
            <button
              onClick={() => setMode("rendered")}
              className={`px-3 py-1.5 text-xs font-medium ${mode === "rendered" ? "bg-white/20 text-white" : "text-white/70 hover:text-white"}`}
            >
              Preview
            </button>
            <button
              onClick={() => setMode("source")}
              className={`px-3 py-1.5 text-xs font-medium ${mode === "source" ? "bg-white/20 text-white" : "text-white/70 hover:text-white"}`}
            >
              Source
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
          {editing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setText(original); setEditing(false); }}
                disabled={saving}
                className="text-white hover:bg-white/10"
              >
                <RotateCcw className="h-4 w-4" /> Discard
              </Button>
              <Button size="sm" onClick={save} disabled={saving || !dirty}>
                <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => { setEditing(true); setMode("source"); }}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoFocus
          className="min-h-[50vh] flex-1 resize-none rounded-lg border border-white/20 bg-neutral-900 p-4 font-mono text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      ) : mode === "rendered" && isHtml ? (
        // Sandboxed with no allow-scripts: this is a stored file and may contain
        // anything. Rendering it in the app's own document would give it our origin.
        <iframe
          title={file.originalFilename}
          sandbox=""
          srcDoc={text}
          className="min-h-[50vh] flex-1 rounded-lg border border-white/20 bg-white"
        />
      ) : mode === "rendered" && isMarkdown ? (
        <div className="min-h-[50vh] flex-1 overflow-auto rounded-lg border border-white/20 bg-neutral-900 p-5">
          <MarkdownView source={text} />
        </div>
      ) : (
        <pre className="min-h-[50vh] flex-1 overflow-auto rounded-lg border border-white/20 bg-neutral-900 p-4 font-mono text-sm text-neutral-100">
          {text}
        </pre>
      )}

      <p className="text-center text-xs text-white/40">
        {new TextEncoder().encode(text).byteLength.toLocaleString()} bytes
        {editing ? " · Ctrl+S to save" : ""}
      </p>
    </div>
  );
}

/**
 * Enough Markdown to read a README.
 *
 * Text is escaped before any markup is added, so a document containing a script tag
 * is shown, not run. A full parser is a dependency this does not need yet — and one
 * that renders raw HTML by default would undo the escaping.
 */
function MarkdownView({ source }: { source: string }) {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const inline = (s: string) =>
    escape(s)
      .replace(/`([^`]+)`/g, '<code class="rounded bg-white/10 px-1 py-0.5">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary underline">$1</a>');

  const html: string[] = [];
  let inCode = false;
  let inList = false;

  for (const raw of source.split(/\r?\n/)) {
    if (raw.trim().startsWith("```")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(inCode ? "</code></pre>" : '<pre class="my-3 overflow-auto rounded bg-black/40 p-3 text-xs"><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { html.push(escape(raw) + "\n"); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(raw);

    if (bullet) {
      if (!inList) { html.push('<ul class="my-2 list-disc pl-6">'); inList = true; }
      html.push(`<li class="my-0.5">${inline(bullet[1]!)}</li>`);
      continue;
    }
    if (inList) { html.push("</ul>"); inList = false; }

    if (heading) {
      const level = heading[1]!.length;
      const size = level === 1 ? "text-2xl" : level === 2 ? "text-xl" : "text-lg";
      html.push(`<h${level} class="mt-4 mb-2 ${size} font-semibold">${inline(heading[2]!)}</h${level}>`);
    } else if (raw.trim() === "") {
      html.push("");
    } else if (/^\s*([-*_])\1{2,}\s*$/.test(raw)) {
      html.push('<hr class="my-4 border-white/20" />');
    } else {
      html.push(`<p class="my-2 leading-relaxed">${inline(raw)}</p>`);
    }
  }
  if (inList) html.push("</ul>");
  if (inCode) html.push("</code></pre>");

  return (
    <div
      className="text-sm text-neutral-100"
      // Every branch above escapes its input before adding markup, so nothing from
      // the document reaches this as live HTML.
      dangerouslySetInnerHTML={{ __html: html.join("\n") }}
    />
  );
}
