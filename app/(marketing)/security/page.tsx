export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-bold text-foreground">security</h1>
      <div className="mt-6 space-y-4 text-muted-foreground">
        <p>This is a placeholder page for the CloudCols security policy. Production content is CMS-driven and editable from the admin panel.</p>
        <p>CloudCols treats your files as private by default. Access requires authentication and authorization, and large files are never proxied through application servers.</p>
      </div>
    </div>
  );
}
