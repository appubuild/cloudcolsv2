// Provider-agnostic file categorization + object-key generation.
// The category is ALWAYS derived from MIME type + extension on the server;
// it is never trusted from the client.

import type { FileCategory } from "@/lib/types";
import { uuid } from "@/lib/utils";

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: "Images",
  video: "Videos",
  audio: "Audio",
  pdf: "PDF",
  document: "Documents",
  archive: "Archives",
  other: "Other",
};

export const ALL_CATEGORIES: FileCategory[] = [
  "image",
  "video",
  "audio",
  "pdf",
  "document",
  "archive",
  "other",
];

/** Derive the authoritative category from MIME (primary) + extension (secondary). */
export function deriveCategory(mime: string, filename: string): FileCategory {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const m = mime.toLowerCase();

  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  if (
    m.includes("document") ||
    m.includes("officedocument") ||
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/vnd.ms-*"
  ) {
    return "document";
  }
  if (
    m === "application/zip" ||
    m === "application/x-rar-compressed" ||
    m === "application/x-7z-compressed" ||
    m === "application/gzip" ||
    m === "application/x-tar" ||
    m.startsWith("application/vnd.rar")
  ) {
    return "archive";
  }
  if (
    ["txt", "csv", "md", "json", "xml", "svg", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf"]
      .includes(ext)
  ) {
    return "document";
  }
  return "other";
}

/** Server-generated, collision-resistant object key. Original filename is metadata only. */
export function buildObjectKey(userId: string, category: FileCategory, filename: string): string {
  const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${userId}/user-files/${category}/${yyyy}/${mm}/CC-${uuid()}.${ext}`;
}

/** A small extension→category guess used only for display fallbacks. */
export function categoryFromExtension(filename: string): FileCategory {
  return deriveCategory("", filename);
}
