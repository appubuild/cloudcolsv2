"use client";

import {
  Folder as FolderIcon,
  Briefcase,
  User,
  Image as ImageIcon,
  Video,
  FileText,
  Star,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The folder icons a user can choose from.
 *
 * The database stores only the key, so this set can grow or change without a
 * migration, and a key this build does not recognise falls back to the plain
 * folder rather than rendering nothing.
 */
export const FOLDER_ICONS = [
  { key: "folder", label: "Default", Icon: FolderIcon, tone: "text-primary bg-primary-soft" },
  { key: "work", label: "Work", Icon: Briefcase, tone: "text-sky-500 bg-sky-500/10" },
  { key: "personal", label: "Personal", Icon: User, tone: "text-violet-500 bg-violet-500/10" },
  { key: "photos", label: "Photos", Icon: ImageIcon, tone: "text-emerald-500 bg-emerald-500/10" },
  { key: "videos", label: "Videos", Icon: Video, tone: "text-rose-500 bg-rose-500/10" },
  { key: "documents", label: "Documents", Icon: FileText, tone: "text-amber-500 bg-amber-500/10" },
  { key: "important", label: "Important", Icon: Star, tone: "text-red-500 bg-red-500/10" },
  { key: "projects", label: "Projects", Icon: Rocket, tone: "text-indigo-500 bg-indigo-500/10" },
] as const;

export type FolderIconKey = (typeof FOLDER_ICONS)[number]["key"];

function resolve(key: string | null | undefined) {
  return FOLDER_ICONS.find((i) => i.key === key) ?? FOLDER_ICONS[0];
}

/** A folder's chosen icon, or the default when it has none. */
export function FolderGlyph({
  icon,
  className,
  iconClassName,
}: {
  icon?: string | null;
  className?: string;
  iconClassName?: string;
}) {
  const { Icon, tone } = resolve(icon);
  return (
    <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", tone, className)}>
      <Icon className={cn("h-5 w-5", iconClassName)} />
    </span>
  );
}
