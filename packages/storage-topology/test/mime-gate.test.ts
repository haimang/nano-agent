/**
 * Tests for `applyMimePolicy` — the workspace/artifact MIME-type gate.
 */

import { describe, it, expect } from "vitest";
import {
  applyMimePolicy,
  DEFAULT_INLINE_TEXT_BYTES,
  PREPARED_TEXT_MIME_TYPES,
} from "../src/mime-gate.js";

describe("applyMimePolicy", () => {
  it("returns signed-url for image/* when the model supports vision", () => {
    const r = applyMimePolicy({ mimeType: "image/png", sizeBytes: 1024, supportsVision: true });
    expect(r.decision).toBe("signed-url");
  });

  it("rejects image/* when the model does not support vision", () => {
    const r = applyMimePolicy({ mimeType: "image/png", sizeBytes: 1024, supportsVision: false });
    expect(r.decision).toBe("reject");
  });

  it("returns prepared-text for PDF / Office MIME types", () => {
    for (const mime of PREPARED_TEXT_MIME_TYPES) {
      expect(applyMimePolicy({ mimeType: mime, sizeBytes: 1024 }).decision).toBe("prepared-text");
    }
  });

  it("returns inline for small text/* attachments", () => {
    const r = applyMimePolicy({ mimeType: "text/plain", sizeBytes: 1024 });
    expect(r.decision).toBe("inline");
    expect(r.thresholdBytes).toBe(DEFAULT_INLINE_TEXT_BYTES);
  });

  it("returns prepared-text for large text/* attachments", () => {
    const r = applyMimePolicy({
      mimeType: "text/plain",
      sizeBytes: DEFAULT_INLINE_TEXT_BYTES + 1,
    });
    expect(r.decision).toBe("prepared-text");
  });

  it("returns inline for application/json under the threshold", () => {
    expect(applyMimePolicy({ mimeType: "application/json", sizeBytes: 2048 }).decision).toBe(
      "inline",
    );
  });

  it("returns reject for unknown MIME types", () => {
    expect(applyMimePolicy({ mimeType: "audio/opus", sizeBytes: 2048 }).decision).toBe("reject");
  });

  it("honours a caller-supplied inlineTextBytes (provisional threshold is tunable)", () => {
    const r = applyMimePolicy(
      { mimeType: "text/plain", sizeBytes: 10_000 },
      { inlineTextBytes: 4_096 },
    );
    expect(r.decision).toBe("prepared-text");
    expect(r.thresholdBytes).toBe(4_096);
  });

  it("carries thresholdBytes forward even on non-text decisions", () => {
    const r = applyMimePolicy({ mimeType: "image/png", sizeBytes: 10, supportsVision: true });
    expect(r.thresholdBytes).toBe(DEFAULT_INLINE_TEXT_BYTES);
  });
});
