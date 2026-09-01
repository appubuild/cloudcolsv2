"use client";

import {
  LayoutDashboard,
  Folder,
  Clock,
  Star,
  Trash2,
  Image,
  Video,
  FileText,
  Music,
  File,
  Share2,
  Database,
  Code2,
  Settings,
  type LucideIcon,
} from "lucide-react";

const map: Record<string, LucideIcon> = {
  LayoutDashboard,
  Folder,
  Clock,
  Star,
  Trash2,
  Image,
  Video,
  FileText,
  Music,
  File,
  Share2,
  Database,
  Code2,
  Settings,
};

export function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = map[name] ?? File;
  return <Cmp className={className} />;
}
