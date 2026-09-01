"use client";

import { useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { FileManager } from "@/components/files/file-manager";
import { Suspense } from "react";

function FilesInner() {
  const params = useParams<{ path?: string[] }>();
  const sp = useSearchParams();
  const folderPath = useMemo(() => (params?.path ? (Array.isArray(params.path) ? params.path : [params.path]) : []), [params?.path]);
  const search = sp.get("search") ?? undefined;

  if (search) {
    return <FileManager mode="search" search={search} />;
  }
  return <FileManager mode="browse" folderPath={folderPath} />;
}

export default function FilesPage() {
  return (
    <Suspense fallback={null}>
      <FilesInner />
    </Suspense>
  );
}
