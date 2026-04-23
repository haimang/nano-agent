import { describe, it, expect } from "vitest";
import { withTimeout, checkDepth } from "../../src/hooks/guards.js";

describe("withTimeout", () => {
  it("resolves when the function completes within the timeout", async () => {
    const result = await withTimeout(
      () => Promise.resolve(42),
      1000,
    );
    expect(result).toBe(42);
  });

  it("rejects when the function exceeds the timeout", async () => {
    await expect(
      withTimeout(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
        50,
      ),
    ).rejects.toThrow("timed out");
  });

  it("rejects immediately if abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withTimeout(() => Promise.resolve(1), 5000, controller.signal),
    ).rejects.toThrow("Aborted before execution");
  });

  it("rejects when abort signal fires during execution", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(
      withTimeout(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
        10_000,
        controller.signal,
      ),
    ).rejects.toThrow("aborted");
  });

  it("propagates errors from the function", async () => {
    await expect(
      withTimeout(
        () => Promise.reject(new Error("boom")),
        1000,
      ),
    ).rejects.toThrow("boom");
  });
});

describe("checkDepth", () => {
  it("does not throw when depth is within limit", () => {
    expect(() => checkDepth(1, 3)).not.toThrow();
    expect(() => checkDepth(3, 3)).not.toThrow();
  });

  it("throws when depth exceeds maximum", () => {
    expect(() => checkDepth(4, 3)).toThrow("exceeds maximum");
  });

  it("throws with descriptive message including both values", () => {
    expect(() => checkDepth(10, 5)).toThrow(
      "Hook recursion depth 10 exceeds maximum of 5",
    );
  });
});
