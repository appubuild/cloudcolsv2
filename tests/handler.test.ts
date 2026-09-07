/**
 * What the API handler tells a client when something goes wrong.
 *
 * The rule has two halves and they pull against each other: a message somebody
 * wrote for the caller should reach them, and a message the runtime produced should
 * not, because those name tables, columns and internal paths.
 *
 * Splitting on the status alone got this wrong in one direction — every 5xx was
 * masked, so maintenance mode told users "Internal server error" and a missing
 * JOBS_TOKEN told the operator the same. Getting it wrong in the other direction
 * leaks. Both halves are pinned here.
 */
import { describe, it, expect } from "vitest";
import { handler, ApiError } from "@/lib/api/auth";

const request = () => new Request("https://example.test/api/thing", { method: "GET" });

async function body(res: Response) {
  return (await res.json()) as { ok: boolean; error?: { code: string; message: string }; data?: unknown };
}

describe("handler error responses", () => {
  it("passes through a deliberate 4xx", async () => {
    const route = handler(async () => {
      throw new ApiError("QUOTA_EXCEEDED", 413, "Storage quota exceeded. Upgrade your plan to continue.");
    });
    const res = await route(request());
    expect(res.status).toBe(413);
    const b = await body(res);
    expect(b.error?.code).toBe("QUOTA_EXCEEDED");
    expect(b.error?.message).toContain("Upgrade your plan");
  });

  it("passes through a deliberate 5xx, because someone wrote that sentence", async () => {
    const route = handler(async () => {
      throw new ApiError("MAINTENANCE", 503, "CloudCols is in maintenance right now.");
    });
    const res = await route(request());
    expect(res.status).toBe(503);
    const b = await body(res);
    expect(b.error?.code).toBe("MAINTENANCE");
    expect(b.error?.message).toBe("CloudCols is in maintenance right now.");
  });

  it("masks an error the runtime produced", async () => {
    const route = handler(async () => {
      throw new Error('relation "user_storage" does not exist at character 42');
    });
    const res = await route(request());
    expect(res.status).toBe(500);
    const b = await body(res);
    expect(b.error?.code).toBe("INTERNAL_ERROR");
    expect(b.error?.message).toBe("Internal server error.");
    // The schema must not travel to the client.
    expect(b.error?.message).not.toContain("user_storage");
  });

  it("masks a thrown object that merely looks like an ApiError", async () => {
    // A plain object with the right fields is not an authored message; it is
    // whatever happened to be thrown.
    const route = handler(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
        code: "DB_DOWN",
        status: 500,
      });
    });
    const res = await route(request());
    const b = await body(res);
    expect(b.error?.message).toBe("Internal server error.");
    expect(b.error?.message).not.toContain("10.0.0.5");
  });

  it("never lets an API response be cached by a proxy", async () => {
    const route = handler(async () => ({ secret: "per-user payload" }));
    const res = await route(request());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
