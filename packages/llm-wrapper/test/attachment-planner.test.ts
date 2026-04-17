import { describe, it, expect } from "vitest";
import { planAttachment, SUPPORTED_MIME_TYPES } from "../src/attachment-planner.js";
import type { ModelCapabilities } from "../src/registry/models.js";

// ── Fixtures ────────────────────────────────────────────────────

const visionModel: ModelCapabilities = {
  modelId: "gpt-4o",
  provider: "openai",
  supportsStream: true,
  supportsTools: true,
  supportsVision: true,
  supportsJsonSchema: true,
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
};

const noVisionModel: ModelCapabilities = {
  modelId: "text-only",
  provider: "openai",
  supportsStream: false,
  supportsTools: false,
  supportsVision: false,
  supportsJsonSchema: false,
  contextWindow: 4096,
  maxOutputTokens: 1024,
};

// ── Tests ───────────────────────────────────────────────────────

describe("planAttachment", () => {
  describe("image types", () => {
    it("routes images to signed-url when vision is supported", () => {
      const plan = planAttachment("image/png", 50_000, visionModel);
      expect(plan.route).toBe("signed-url");
      expect(plan.mimeType).toBe("image/png");
    });

    it("routes jpeg to signed-url with vision", () => {
      const plan = planAttachment("image/jpeg", 100_000, visionModel);
      expect(plan.route).toBe("signed-url");
    });

    it("rejects images when vision is not supported", () => {
      const plan = planAttachment("image/png", 50_000, noVisionModel);
      expect(plan.route).toBe("reject");
      expect(plan.reason).toContain("does not support vision");
    });

    it("rejects gif without vision", () => {
      const plan = planAttachment("image/gif", 20_000, noVisionModel);
      expect(plan.route).toBe("reject");
    });
  });

  describe("document types", () => {
    it("routes PDF to prepared-text", () => {
      const plan = planAttachment("application/pdf", 500_000, visionModel);
      expect(plan.route).toBe("prepared-text");
      expect(plan.reason).toContain("text extraction");
    });

    it("routes DOCX to prepared-text", () => {
      const plan = planAttachment(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        200_000,
        visionModel,
      );
      expect(plan.route).toBe("prepared-text");
    });

    it("routes XLSX to prepared-text", () => {
      const plan = planAttachment(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        300_000,
        noVisionModel,
      );
      expect(plan.route).toBe("prepared-text");
    });

    it("routes PPTX to prepared-text", () => {
      const plan = planAttachment(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        400_000,
        visionModel,
      );
      expect(plan.route).toBe("prepared-text");
    });
  });

  describe("text types", () => {
    it("routes small text/plain to inline", () => {
      const plan = planAttachment("text/plain", 1_000, visionModel);
      expect(plan.route).toBe("inline");
      expect(plan.reason).toContain("within size limit");
    });

    it("routes small text/markdown to inline", () => {
      const plan = planAttachment("text/markdown", 50_000, visionModel);
      expect(plan.route).toBe("inline");
    });

    it("routes small application/json to inline", () => {
      const plan = planAttachment("application/json", 10_000, noVisionModel);
      expect(plan.route).toBe("inline");
    });

    it("routes small application/xml to inline", () => {
      const plan = planAttachment("application/xml", 5_000, noVisionModel);
      expect(plan.route).toBe("inline");
    });

    it("routes text at exactly 100KB to inline", () => {
      const plan = planAttachment("text/plain", 100 * 1024, visionModel);
      expect(plan.route).toBe("inline");
    });

    it("routes large text/plain to prepared-text", () => {
      const plan = planAttachment("text/plain", 100 * 1024 + 1, visionModel);
      expect(plan.route).toBe("prepared-text");
      expect(plan.reason).toContain("too large");
    });

    it("routes large application/json to prepared-text", () => {
      const plan = planAttachment("application/json", 200_000, noVisionModel);
      expect(plan.route).toBe("prepared-text");
    });
  });

  describe("unsupported types", () => {
    it("rejects application/octet-stream", () => {
      const plan = planAttachment("application/octet-stream", 1_000, visionModel);
      expect(plan.route).toBe("reject");
      expect(plan.reason).toContain("not supported");
    });

    it("rejects audio/mp3", () => {
      const plan = planAttachment("audio/mp3", 1_000_000, visionModel);
      expect(plan.route).toBe("reject");
    });

    it("rejects video/mp4", () => {
      const plan = planAttachment("video/mp4", 5_000_000, visionModel);
      expect(plan.route).toBe("reject");
    });
  });
});

describe("SUPPORTED_MIME_TYPES", () => {
  it("includes common text types", () => {
    expect(SUPPORTED_MIME_TYPES.has("text/plain")).toBe(true);
    expect(SUPPORTED_MIME_TYPES.has("text/markdown")).toBe(true);
    expect(SUPPORTED_MIME_TYPES.has("text/html")).toBe(true);
    expect(SUPPORTED_MIME_TYPES.has("text/csv")).toBe(true);
    expect(SUPPORTED_MIME_TYPES.has("application/json")).toBe(true);
  });

  it("includes common image types", () => {
    expect(SUPPORTED_MIME_TYPES.has("image/png")).toBe(true);
    expect(SUPPORTED_MIME_TYPES.has("image/jpeg")).toBe(true);
    expect(SUPPORTED_MIME_TYPES.has("image/gif")).toBe(true);
    expect(SUPPORTED_MIME_TYPES.has("image/webp")).toBe(true);
  });

  it("includes document types", () => {
    expect(SUPPORTED_MIME_TYPES.has("application/pdf")).toBe(true);
  });

  it("does not include unsupported types", () => {
    expect(SUPPORTED_MIME_TYPES.has("application/octet-stream")).toBe(false);
    expect(SUPPORTED_MIME_TYPES.has("audio/mp3")).toBe(false);
  });
});
