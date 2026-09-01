import { describe, it, expect } from "vitest";
import { assertCanUpload } from "../lib/api/quota";
import type { QuotaState } from "../lib/api/quota";
import { ApiError } from "../lib/api/auth";

const free: QuotaState = {
  used: 1 * 1024 * 1024 * 1024,
  quota: 5 * 1024 * 1024 * 1024,
  planId: "plan_free",
  maxFileSizeBytes: 1 * 1024 * 1024 * 1024,
};

describe("quota (server-side enforcement)", () => {
  it("allows an upload within quota and file-size limits", () => {
    expect(() => assertCanUpload(free, 100 * 1024 * 1024)).not.toThrow();
  });

  it("rejects an upload that exceeds the plan quota", () => {
    try {
      assertCanUpload(free, 5 * 1024 * 1024 * 1024);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ApiError).code).toBe("QUOTA_EXCEEDED");
    }
  });

  it("rejects an upload larger than the max file size", () => {
    try {
      assertCanUpload(free, 2 * 1024 * 1024 * 1024);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ApiError).code).toBe("FILE_TOO_LARGE");
    }
  });

  it("rejects a non-positive size", () => {
    try {
      assertCanUpload(free, 0);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ApiError).code).toBe("INVALID_INPUT");
    }
  });
});
