"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus, Undo2, Redo2, Link2, Link2Off,
} from "lucide-react";

/**
 * The page editor.
 *
 * TipTap over a bare contentEditable because the hard parts of a rich text editor are
 * the ones nobody sees: what pressing Enter inside a list item does, what pasting from
 * Word produces, whether undo groups sensibly. A schema-backed editor answers those;
 * a div with contentEditable answers them differently in every browser.
 *
 * What comes out is HTML, and it is sanitised on the server before it is stored — see
 * lib/content/sanitize. Nothing here is a security control: an editor runs in the
 * author's own browser and can be bypassed by anyone willing to use the network tab.
 */
export function RichTextEditor({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  className?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Its own link handling is replaced below so the attributes can be pinned.
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // Matches what the sanitiser will keep. An editor that offers something the
        // server then strips is an editor that appears to lose the author's work.
        protocols: ["http", "https", "mailto", "tel"],
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
    ],
    content: value,
    // Rendering the editor on the server produces markup React then disagrees with.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose-sm max-w-none min-h-[320px] px-4 py-3 focus:outline-none " +
          "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 " +
          "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 " +
          "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 " +
          "[&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 " +
          "[&_li]:my-1 [&_a]:text-primary [&_a]:underline " +
          "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic " +
          "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm " +
          "[&_hr]:my-4 [&_hr]:border-border",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // Loading a different page into the same editor. Guarded on the current value so
  // typing does not fight the prop and reset the cursor on every keystroke.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return <div className={cn("min-h-[380px] rounded-lg border border-border bg-surface", className)} />;
  }

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link address", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-2 px-2 py-1.5">
        <Tool icon={<Bold className="h-4 w-4" />} label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
        <Tool icon={<Italic className="h-4 w-4" />} label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Tool icon={<Strikethrough className="h-4 w-4" />} label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Tool icon={<Code className="h-4 w-4" />} label="Code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} />
        <Divider />
        <Tool icon={<Heading1 className="h-4 w-4" />} label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <Tool icon={<Heading2 className="h-4 w-4" />} label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <Tool icon={<Heading3 className="h-4 w-4" />} label="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <Divider />
        <Tool icon={<List className="h-4 w-4" />} label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Tool icon={<ListOrdered className="h-4 w-4" />} label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <Tool icon={<Quote className="h-4 w-4" />} label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <Tool icon={<Minus className="h-4 w-4" />} label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        <Divider />
        <Tool icon={<Link2 className="h-4 w-4" />} label="Add link" active={editor.isActive("link")} onClick={setLink} />
        <Tool icon={<Link2Off className="h-4 w-4" />} label="Remove link" onClick={() => editor.chain().focus().unsetLink().run()} />
        <Divider />
        <Tool icon={<Undo2 className="h-4 w-4" />} label="Undo" onClick={() => editor.chain().focus().undo().run()} />
        <Tool icon={<Redo2 className="h-4 w-4" />} label="Redo" onClick={() => editor.chain().focus().redo().run()} />
      </div>
      <EditorContent editor={editor} className="text-foreground" />
    </div>
  );
}

function Tool({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      aria-pressed={active ?? false}
      onClick={onClick}
      className={cn("h-8 w-8 p-0", active && "bg-primary-soft text-primary")}
    >
      {icon}
    </Button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
}
