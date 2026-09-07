/**
 * The page sanitiser.
 *
 * This is a security control, not a formatting nicety. Page HTML is written by an
 * admin and served to every visitor from the product's own origin, so anything that
 * survives here runs with that origin's privileges. If a staff account is ever taken
 * over, this is what stands between that and stored XSS on the marketing site.
 *
 * The cases below are the ones block-lists lose to: unclosed tags, case tricks,
 * entity-encoded protocols, whitespace inside a scheme, event handlers on otherwise
 * innocent elements.
 */
import { describe, it, expect } from "vitest";
import { sanitizeHtml, excerptFrom, toSlug, RESERVED_SLUGS } from "@/lib/content/sanitize";

describe("sanitizeHtml — what it keeps", () => {
  it("keeps ordinary formatting", () => {
    const html = "<h2>Terms</h2><p>Some <strong>bold</strong> and <em>italic</em> text.</p>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("keeps lists, quotes and rules", () => {
    const out = sanitizeHtml("<ul><li>one</li><li>two</li></ul><blockquote>q</blockquote><hr>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<blockquote>q</blockquote>");
    expect(out).toContain("<hr />");
  });

  it("keeps a safe link and forces noopener when it opens a new tab", () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("keeps relative, anchor, mailto and tel links", () => {
    for (const href of ["/pricing", "#section", "mailto:a@b.com", "tel:+123"]) {
      expect(sanitizeHtml(`<a href="${href}">x</a>`)).toContain(`href="${href}"`);
    }
  });
});

describe("sanitizeHtml — what it removes", () => {
  it("removes a script and its contents", () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).toBe("<p>ok</p>");
    expect(out).not.toContain("alert");
  });

  it("removes an unclosed script — the usual way a naive strip is bypassed", () => {
    const out = sanitizeHtml('<p>ok</p><script src="//evil.test/x.js">');
    expect(out.toLowerCase()).not.toContain("script");
    expect(out).not.toContain("evil.test");
  });

  it("is not fooled by case", () => {
    const out = sanitizeHtml("<ScRiPt>alert(1)</ScRiPt><IMG SRC=x>");
    expect(out.toLowerCase()).not.toContain("script");
    expect(out.toLowerCase()).not.toContain("<img");
  });

  it("removes event handlers from allowed elements", () => {
    const out = sanitizeHtml('<p onclick="steal()">text</p><div onmouseover="x">d</div>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onmouseover");
    expect(out).toContain("text");
  });

  it("removes a javascript: link but keeps its text", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript");
    expect(out).toContain("click");
  });

  it("removes an entity-encoded javascript: link", () => {
    // `java&#115;cript:` decodes to javascript: in a browser's URL parser.
    const out = sanitizeHtml('<a href="java&#115;cript:alert(1)">click</a>');
    expect(out).not.toContain("script:");
  });

  it("removes a javascript: link broken up with whitespace", () => {
    const out = sanitizeHtml('<a href="java\nscript:alert(1)">click</a>');
    expect(out).not.toMatch(/href=/);
  });

  it("removes data: URLs, which can carry HTML", () => {
    const out = sanitizeHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>');
    expect(out).not.toContain("data:");
  });

  it("removes iframes, objects, embeds and svg", () => {
    const out = sanitizeHtml(
      '<iframe src="//evil.test"></iframe><object data="x"></object><embed src="y"><svg onload="alert(1)"></svg>',
    );
    expect(out).toBe("");
  });

  it("removes style blocks", () => {
    // CSS can load and position things, and has been an exfiltration vector.
    expect(sanitizeHtml("<style>body{display:none}</style><p>hi</p>")).toBe("<p>hi</p>");
  });

  it("removes comments", () => {
    expect(sanitizeHtml("<!-- [if IE]><script>x</script><![endif] --><p>hi</p>")).toBe("<p>hi</p>");
  });

  it("removes form and input elements", () => {
    const out = sanitizeHtml('<form action="//evil.test"><input name="password"></form><p>hi</p>');
    expect(out.toLowerCase()).not.toContain("<form");
    expect(out.toLowerCase()).not.toContain("<input");
    expect(out).toContain("hi");
  });

  it("escapes a stray angle bracket rather than leaving it to the browser", () => {
    expect(sanitizeHtml("a < b")).toContain("&lt;");
  });

  it("survives an empty or absent value", () => {
    expect(sanitizeHtml("")).toBe("");
    expect(sanitizeHtml(undefined as unknown as string)).toBe("");
  });
});

describe("excerptFrom", () => {
  it("strips markup and collapses whitespace", () => {
    expect(excerptFrom("<h1>Hello</h1>\n<p>  there  </p>")).toBe("Hello there");
  });

  it("truncates long text with an ellipsis", () => {
    const out = excerptFrom(`<p>${"word ".repeat(100)}</p>`, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("toSlug", () => {
  it("makes a title into an address", () => {
    expect(toSlug("Terms of Service!")).toBe("terms-of-service");
    expect(toSlug("  Multiple   spaces  ")).toBe("multiple-spaces");
  });

  it("cannot produce path traversal or a leading slash", () => {
    expect(toSlug("../../etc/passwd")).toBe("etcpasswd");
    expect(toSlug("/admin")).toBe("admin");
  });

  it("reserves the addresses the application already owns", () => {
    // A page at /p/admin is harmless, but the reserved list is what stops one being
    // created at an address the router would otherwise fight over.
    for (const s of ["app", "admin", "api", "login", "s"]) {
      expect(RESERVED_SLUGS.has(s)).toBe(true);
    }
  });
});
