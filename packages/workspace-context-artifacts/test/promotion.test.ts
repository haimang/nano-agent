import { describe, it, expect } from "vitest";
import {
  shouldPromoteResult,
  promoteToArtifactRef,
  DEFAULT_PROMOTION_POLICY,
} from "../src/promotion.js";
import type { PromotionPolicy } from "../src/promotion.js";

describe("shouldPromoteResult", () => {
  it("promotes when content exceeds maxInlineBytes", () => {
    const largeContent = "x".repeat(5000);
    const result = shouldPromoteResult(largeContent);
    expect(result.promote).toBe(true);
    expect(result.reason).toContain("exceeds inline limit");
  });

  it("does not promote small content without promotable MIME type", () => {
    const result = shouldPromoteResult("small content");
    expect(result.promote).toBe(false);
    expect(result.reason).toContain("within inline limits");
  });

  it("promotes when MIME type is in promotable set", () => {
    const result = shouldPromoteResult("small", "application/json");
    expect(result.promote).toBe(true);
    expect(result.reason).toContain("MIME type");
  });

  it("does not promote unknown MIME type under size limit", () => {
    const result = shouldPromoteResult("small", "application/x-unknown");
    expect(result.promote).toBe(false);
  });

  it("uses custom policy when provided", () => {
    const customPolicy: PromotionPolicy = {
      maxInlineBytes: 10,
      promotableMimeTypes: new Set(["text/custom"]),
      coldTierSizeBytes: 1024,
    };

    const result1 = shouldPromoteResult("short", "text/custom", customPolicy);
    expect(result1.promote).toBe(true);

    const result2 = shouldPromoteResult("this is more than ten bytes", undefined, customPolicy);
    expect(result2.promote).toBe(true);
  });

  it("size check uses byte length, not character length", () => {
    const policy: PromotionPolicy = {
      maxInlineBytes: 10,
      promotableMimeTypes: new Set(),
      coldTierSizeBytes: 1024,
    };
    const emojis = "\u{1F600}\u{1F601}\u{1F602}";
    const result = shouldPromoteResult(emojis, undefined, policy);
    expect(result.promote).toBe(true);
  });

  it("default policy has expected MIME types", () => {
    expect(DEFAULT_PROMOTION_POLICY.promotableMimeTypes.has("application/json")).toBe(true);
    expect(DEFAULT_PROMOTION_POLICY.promotableMimeTypes.has("text/plain")).toBe(true);
    expect(DEFAULT_PROMOTION_POLICY.promotableMimeTypes.has("image/png")).toBe(true);
    expect(DEFAULT_PROMOTION_POLICY.promotableMimeTypes.has("application/pdf")).toBe(true);
  });
});

describe("promoteToArtifactRef", () => {
  it("creates a NacpRef-shaped artifact ref with correct fields", () => {
    const ref = promoteToArtifactRef("team-1", "hello world", "text/plain", "file");

    expect(ref.artifactKind).toBe("file");
    expect(ref.team_uuid).toBe("team-1");
    expect(ref.content_type).toBe("text/plain");
    expect(ref.size_bytes).toBe(new TextEncoder().encode("hello world").length);
    expect(ref.createdAt).toBeTruthy();
    // Key is tenant-prefixed (R7 regression guard)
    expect(ref.key.startsWith("tenants/team-1/")).toBe(true);
    expect(ref.key).toContain("artifacts/file/");
  });

  it("uses do-storage backend for small content", () => {
    const ref = promoteToArtifactRef("team-1", "small", "text/plain", "file");
    expect(ref.kind).toBe("do-storage");
    expect(ref.binding).toBe("SESSION_DO");
  });

  it("uses r2 backend for large content (>1MB default)", () => {
    const largeContent = "x".repeat(1024 * 1024 + 1);
    const ref = promoteToArtifactRef("team-1", largeContent, "text/plain", "file");
    expect(ref.kind).toBe("r2");
    expect(ref.binding).toBe("WORKSPACE_R2");
  });

  it("honours a caller-supplied coldTierSizeBytes", () => {
    const ref = promoteToArtifactRef(
      "team-1",
      "x".repeat(2048),
      "text/plain",
      "file",
      { policy: { ...DEFAULT_PROMOTION_POLICY, coldTierSizeBytes: 1024 } },
    );
    expect(ref.kind).toBe("r2");
  });

  it("generates unique keys for different calls", () => {
    const ref1 = promoteToArtifactRef("team-1", "a", "text/plain", "file");
    const ref2 = promoteToArtifactRef("team-1", "b", "text/plain", "file");
    expect(ref1.key).not.toBe(ref2.key);
  });

  it("supports different artifact kinds", () => {
    const ref = promoteToArtifactRef("team-1", "data", "image/png", "image");
    expect(ref.artifactKind).toBe("image");
    expect(ref.key).toContain("/artifacts/image/");
  });

  it("idFactory option produces deterministic keys", () => {
    const ref = promoteToArtifactRef("team-1", "x", "text/plain", "file", {
      idFactory: () => "fixed-id",
    });
    expect(ref.key).toBe("tenants/team-1/artifacts/file/fixed-id");
  });
});
