import { describe, it, expect } from "vitest";
import { shouldPromote } from "../src/artifact-promotion.js";
import { INLINE_RESULT_MAX_BYTES } from "../src/result.js";
import type { CapabilityResult } from "../src/result.js";

function makeResult(overrides: Partial<CapabilityResult>): CapabilityResult {
  return {
    kind: "inline",
    capabilityName: "test",
    requestId: "req-1",
    durationMs: 10,
    ...overrides,
  };
}

describe("shouldPromote", () => {
  it("does not promote small output", () => {
    const result = makeResult({ output: "hello", outputSizeBytes: 5 });
    const decision = shouldPromote(result);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toContain("within threshold");
  });

  it("promotes output exceeding default threshold", () => {
    const bigOutput = "x".repeat(INLINE_RESULT_MAX_BYTES + 1);
    const result = makeResult({
      output: bigOutput,
      outputSizeBytes: INLINE_RESULT_MAX_BYTES + 1,
    });
    const decision = shouldPromote(result);
    expect(decision.promote).toBe(true);
    expect(decision.reason).toContain("exceeds threshold");
  });

  it("uses custom threshold when provided", () => {
    const result = makeResult({ output: "hello world", outputSizeBytes: 11 });
    const decision = shouldPromote(result, 5);
    expect(decision.promote).toBe(true);
  });

  it("does not promote error results", () => {
    const result = makeResult({
      kind: "error",
      error: { code: "fail", message: "oops" },
    });
    const decision = shouldPromote(result);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toContain("not eligible");
  });

  it("does not promote cancelled results", () => {
    const result = makeResult({ kind: "cancelled" });
    const decision = shouldPromote(result);
    expect(decision.promote).toBe(false);
  });

  it("does not promote timeout results", () => {
    const result = makeResult({ kind: "timeout" });
    const decision = shouldPromote(result);
    expect(decision.promote).toBe(false);
  });

  it("does not promote when there is no output", () => {
    const result = makeResult({ output: undefined });
    const decision = shouldPromote(result);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toContain("No output");
  });

  it("calculates size from output string when outputSizeBytes is not provided", () => {
    const result = makeResult({ output: "a".repeat(100) });
    const decision = shouldPromote(result, 50);
    expect(decision.promote).toBe(true);
  });

  it("INLINE_RESULT_MAX_BYTES is 64KB", () => {
    expect(INLINE_RESULT_MAX_BYTES).toBe(64 * 1024);
  });
});
