export interface NavItem {
  label: string;
  href: string;
  icon: string; // lucide icon key resolved by the caller
  section?: string;
  badge?: string;
}

export const appNav: {
  section: string;
  items: { label: string; href: string; icon: string; badge?: string }[];
}[] = [
  {
    section: "Library",
    items: [
      { label: "Dashboard", href: "/app", icon: "LayoutDashboard" },
      { label: "My Files", href: "/app/files", icon: "Folder" },
      { label: "Recent", href: "/app/recent", icon: "Clock" },
      { label: "Favorites", href: "/app/favorites", icon: "Star" },
      { label: "Trash", href: "/app/trash", icon: "Trash2" },
    ],
  },
  {
    section: "Types",
    items: [
      { label: "Images", href: "/app/images", icon: "Image" },
      { label: "Videos", href: "/app/videos", icon: "Video" },
      { label: "Documents", href: "/app/documents", icon: "FileText" },
      { label: "PDF", href: "/app/pdf", icon: "FileText" },
      { label: "Audio", href: "/app/audio", icon: "Music" },
      { label: "Other", href: "/app/other", icon: "File" },
    ],
  },
  {
    section: "Account",
    items: [
      { label: "Shared", href: "/app/shared", icon: "Share2" },
      { label: "Storage", href: "/app/storage", icon: "Database" },
      { label: "Developer", href: "/developers", icon: "Code2" },
      { label: "Settings", href: "/app/settings", icon: "Settings" },
    ],
  },
];
