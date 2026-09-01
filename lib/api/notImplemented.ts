import { ApiError } from "./auth";

// For endpoints whose backend wiring is Phase-2.1+ (admin/dev/subscriptions/
// notifications tables). They return a clear, non-crashing response so the UI
// degrades gracefully rather than throwing. Swap them for real table-backed
// handlers as those subsystems are built.

export function notImplemented(feature: string): never {
  throw new ApiError("NOT_IMPLEMENTED", 501, `${feature} is not wired to the API yet.`);
}
