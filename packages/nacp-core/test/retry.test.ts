import { describe, it, expect } from "vitest";
import { decideRetry, calculateBackoffDelay } from "../src/retry.js";

const DEFAULT_POLICY = {
  max_attempts: 3,
  base_delay_ms: 200,
  max_delay_ms: 10_000,
  jitter_ratio: 0.2,
};

describe("decideRetry", () => {
  it("retries when attempts remaining and error is retryable", () => {
    const decision = decideRetry(0, DEFAULT_POLICY, true);
    expect(decision.should_retry).toBe(true);
    expect(decision.reason).toBe("attempts_remaining");
    expect(decision.next_delay_ms).toBeGreaterThan(0);
  });

  it("stops when max_attempts reached", () => {
    const decision = decideRetry(3, DEFAULT_POLICY, true);
    expect(decision.should_retry).toBe(false);
    expect(decision.reason).toBe("max_attempts_reached");
    expect(decision.next_delay_ms).toBe(0);
  });

  it("stops for non-retryable error regardless of attempt", () => {
    const decision = decideRetry(0, DEFAULT_POLICY, false);
    expect(decision.should_retry).toBe(false);
    expect(decision.reason).toBe("non_retryable_error");
  });

  it("handles attempt = max_attempts - 1 (last retry)", () => {
    const decision = decideRetry(2, DEFAULT_POLICY, true);
    expect(decision.should_retry).toBe(true);
    expect(decision.reason).toBe("attempts_remaining");
  });

  it("handles attempt 0 with retryable error", () => {
    const decision = decideRetry(0, DEFAULT_POLICY, true);
    expect(decision.should_retry).toBe(true);
    expect(decision.next_delay_ms).toBeGreaterThanOrEqual(200);
    expect(decision.next_delay_ms).toBeLessThanOrEqual(240); // 200 + 20% jitter max
  });
});

describe("calculateBackoffDelay", () => {
  it("starts at base_delay_ms for attempt 1", () => {
    const delay = calculateBackoffDelay(1, DEFAULT_POLICY);
    expect(delay).toBeGreaterThanOrEqual(200);
    expect(delay).toBeLessThanOrEqual(240);
  });

  it("doubles for subsequent attempts", () => {
    const delays: number[] = [];
    for (let i = 1; i <= 5; i++) {
      delays.push(calculateBackoffDelay(i, { ...DEFAULT_POLICY, jitter_ratio: 0 }));
    }
    // Without jitter: 200, 400, 800, 1600, 3200
    expect(delays[0]).toBe(200);
    expect(delays[1]).toBe(400);
    expect(delays[2]).toBe(800);
    expect(delays[3]).toBe(1600);
    expect(delays[4]).toBe(3200);
  });

  it("caps at max_delay_ms", () => {
    const delay = calculateBackoffDelay(20, { ...DEFAULT_POLICY, jitter_ratio: 0 });
    expect(delay).toBe(10_000);
  });

  it("adds jitter within ratio", () => {
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) {
      delays.add(calculateBackoffDelay(1, DEFAULT_POLICY));
    }
    // With jitter, we should see some variance (not all identical)
    expect(delays.size).toBeGreaterThan(1);
  });
});
