import { describe, it, expect } from "vitest";
import { EMAIL_TEMPLATES, sendTransactional } from "../lib/email/index";

describe("email templates", () => {
  it("every template renders a subject + body", () => {
    for (const [name, tpl] of Object.entries(EMAIL_TEMPLATES)) {
      const r = tpl({ name: "Alex", quota: "5 GB", link: "https://x", days: "30", grace: "7", plan: "Pro", label: "my key", message: "hi", subject: "s", body: "b" });
      expect(name).toBeTruthy();
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.body).toContain("<p>");
    }
  });
});

describe("sendTransactional", () => {
  it("falls back to console and never throws without a provider", async () => {
    // No RESEND_API_KEY in test env → console provider.
    const res = await sendTransactional({ to: "a@b.com", template: "welcome", data: { name: "A", quota: "5 GB", link: "https://x" } });
    expect(res.sent).toBe(false);
    expect(res.provider).toBe("console");
  });
});
