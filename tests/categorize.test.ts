import { describe, it, expect } from "vitest";
import { deriveCategory } from "@/lib/repositories/mock";

describe("deriveCategory (backend-authoritative)", () => {
  it("classifies images by mime", () => expect(deriveCategory("image/png", "x.png")).toBe("image"));
  it("classifies videos", () => expect(deriveCategory("video/mp4", "clip.mp4")).toBe("video"));
  it("classifies audio", () => expect(deriveCategory("audio/mpeg", "song.mp3")).toBe("audio"));
  it("classifies pdf", () => expect(deriveCategory("application/pdf", "doc.pdf")).toBe("pdf"));
  it("classifies documents", () => expect(deriveCategory("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "doc.docx")).toBe("document"));
  it("classifies archives", () => expect(deriveCategory("application/zip", "bundle.zip")).toBe("archive"));
  it("uses extension for unknown mime", () => expect(deriveCategory("application/octet-stream", "data.csv")).toBe("document"));
  it("falls back to other", () => expect(deriveCategory("application/octet-stream", "blob.bin")).toBe("other"));
  it("does not trust a misleading extension over mime", () => expect(deriveCategory("image/png", "file.jpg")).toBe("image"));
});
