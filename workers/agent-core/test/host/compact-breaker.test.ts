import { describe, expect, it } from "vitest";
import { createCompactBreaker } from "../../src/host/compact-breaker.js";

describe("compact breaker", () => {
  it("reopens after the configured cool-down", () => {
    let now = 1_000;
    const breaker = createCompactBreaker(2, 100, () => now);

    expect(breaker.canCompact()).toBe(true);
    breaker.recordFailure();
    expect(breaker.canCompact()).toBe(true);
    breaker.recordFailure();
    expect(breaker.canCompact()).toBe(false);

    now += 99;
    expect(breaker.canCompact()).toBe(false);

    now += 1;
    expect(breaker.canCompact()).toBe(true);
    expect(breaker.currentFailures()).toBe(0);
  });

  it("resets immediately on success", () => {
    const breaker = createCompactBreaker(2, 100);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.canCompact()).toBe(false);

    breaker.recordSuccess();
    expect(breaker.currentFailures()).toBe(0);
    expect(breaker.canCompact()).toBe(true);
  });
});
