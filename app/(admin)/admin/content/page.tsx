"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/store/toast";
import { LandingEditor } from "@/components/admin/landing-editor";

const faqs = [
  { q: "How do I upgrade my storage?", a: "Go to Settings → Billing & Plan and choose a plan." },
  { q: "What happens when I delete a file?", a: "It moves to Trash for 30 days, then is removed." },
  { q: "Is the Developer API included in my plan?", a: "No — the Developer API is billed separately." },
  { q: "How secure is my data?", a: "Files are private by default and served over signed URLs." },
];

export default function AdminContentPage() {
  const [tab, setTab] = useState("faq");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Content</h1>
        <p className="mt-1 text-sm text-muted-foreground">Landing content, FAQ, and announcements.</p>
      </div>
      <Tabs tabs={[{ id: "faq", label: "FAQ" }, { id: "landing", label: "Landing" }, { id: "announcements", label: "Announcements" }]} value={tab} onChange={setTab} />

      {tab === "faq" && (
        <Card>
          <CardContent className="space-y-3">
            {faqs.map((f) => (
              <div key={f.q} className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium text-foreground">{f.q}</p>
                <p className="mt-1 text-sm text-muted-foreground">{f.a}</p>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => toast.success("FAQ updated")}>Save changes</Button>
          </CardContent>
        </Card>
      )}

      {tab === "landing" && <LandingEditor />}

      {tab === "announcements" && (
        <Card>
          <CardContent className="space-y-2">
            {[
              { title: "Maintenance window", status: "active" },
              { title: "New: Developer API", status: "active" },
              { title: "Summer promo", status: "scheduled" },
            ].map((a) => (
              <div key={a.title} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{a.title}</span>
                <Badge tone={a.status === "active" ? "success" : "warning"}>{a.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
