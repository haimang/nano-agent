/**
 * B4 — budget/ policy tests.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_COMPACT_POLICY,
  applyEnvOverride,
  effectivePromptBudget,
  headroomTokens,
  mergeCompactPolicy,
  shouldArm,
  shouldHardFallback,
  usagePct,
} from "../../src/budget/index.js";

describe("budget — DEFAULT_COMPACT_POLICY (PX spec §3.1)", () => {
  it("matches the canonical spec defaults", () => {
    expect(DEFAULT_COMPACT_POLICY).toEqual({
      softTriggerPct: 0.75,
      hardFallbackPct: 0.95,
      minHeadroomTokensForBackground: 5_000,
      backgroundTimeoutMs: 30_000,
      maxRetriesAfterFailure: 1,
      disabled: false,
    });
  });

  it("DEFAULT is frozen — caller can't mutate it accidentally", () => {
    expect(() => {
      (DEFAULT_COMPACT_POLICY as unknown as { softTriggerPct: number }).softTriggerPct = 0.5;
    }).toThrow();
  });
});

describe("budget — mergeCompactPolicy", () => {
  it("returns defaults when no override is supplied", () => {
    expect(mergeCompactPolicy()).toEqual(DEFAULT_COMPACT_POLICY);
  });

  it("applies per-field override", () => {
    const merged = mergeCompactPolicy({ softTriggerPct: 0.8, disabled: true });
    expect(merged.softTriggerPct).toBe(0.8);
    expect(merged.disabled).toBe(true);
    expect(merged.hardFallbackPct).toBe(DEFAULT_COMPACT_POLICY.hardFallbackPct);
  });

  it("rejects soft >= hard", () => {
    expect(() =>
      mergeCompactPolicy({ softTriggerPct: 0.9, hardFallbackPct: 0.85 }),
    ).toThrow(/soft < hard/);
  });

  it("rejects soft <= 0 / hard > 1", () => {
    expect(() => mergeCompactPolicy({ softTriggerPct: 0 })).toThrow();
    expect(() => mergeCompactPolicy({ hardFallbackPct: 1.5 })).toThrow();
  });

  it("rejects negative numeric fields", () => {
    expect(() =>
      mergeCompactPolicy({ minHeadroomTokensForBackground: -1 }),
    ).toThrow();
    expect(() => mergeCompactPolicy({ backgroundTimeoutMs: -5 })).toThrow();
    expect(() => mergeCompactPolicy({ maxRetriesAfterFailure: -2 })).toThrow();
  });
});

describe("budget — usage helpers", () => {
  it("effectivePromptBudget = max(0, hard - reserve)", () => {
    expect(
      effectivePromptBudget({ hardLimitTokens: 100_000, responseReserveTokens: 4_000 }),
    ).toBe(96_000);
    expect(
      effectivePromptBudget({ hardLimitTokens: 1_000, responseReserveTokens: 5_000 }),
    ).toBe(0);
  });

  it("usagePct uses (max - reserve) as denominator", () => {
    const pct = usagePct({
      totalTokens: 48_000,
      maxTokens: 100_000,
      responseReserveTokens: 4_000,
      categories: [],
    });
    expect(pct).toBeCloseTo(0.5);
  });

  it("usagePct returns +Infinity when budget is zero", () => {
    expect(
      usagePct({
        totalTokens: 1,
        maxTokens: 0,
        responseReserveTokens: 0,
        categories: [],
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("headroomTokens reports free tokens; never < 0", () => {
    expect(
      headroomTokens({
        totalTokens: 80_000,
        maxTokens: 100_000,
        responseReserveTokens: 4_000,
        categories: [],
      }),
    ).toBe(16_000);
    expect(
      headroomTokens({
        totalTokens: 200_000,
        maxTokens: 100_000,
        responseReserveTokens: 4_000,
        categories: [],
      }),
    ).toBe(0);
  });
});

describe("budget — threshold predicates", () => {
  const usage = (totalTokens: number, max = 100_000) => ({
    totalTokens,
    maxTokens: max,
    responseReserveTokens: 4_000,
    categories: [],
  });

  it("shouldArm fires at or above softTriggerPct", () => {
    const policy = DEFAULT_COMPACT_POLICY;
    // soft = 0.75 of (100k - 4k) = 72_000
    expect(shouldArm(usage(71_999), policy)).toBe(false);
    expect(shouldArm(usage(72_000), policy)).toBe(true);
  });

  it("shouldArm respects minHeadroomTokensForBackground guard", () => {
    // Build a context whose absolute headroom is tiny (e.g. 1k),
    // even though the percentage is high.
    const policy = mergeCompactPolicy({
      minHeadroomTokensForBackground: 5_000,
    });
    const u = {
      totalTokens: 95_000,
      maxTokens: 100_000,
      responseReserveTokens: 4_000,
      categories: [],
    };
    expect(headroomTokens(u)).toBe(1_000);
    expect(shouldArm(u, policy)).toBe(false);
  });

  it("shouldHardFallback fires at or above hardFallbackPct", () => {
    const policy = DEFAULT_COMPACT_POLICY;
    expect(shouldHardFallback(usage(91_000), policy)).toBe(false);
    // 0.95 of 96_000 = 91_200
    expect(shouldHardFallback(usage(92_000), policy)).toBe(true);
  });

  it("disabled policy returns false everywhere", () => {
    const disabled = mergeCompactPolicy({ disabled: true });
    expect(shouldArm(usage(95_000), disabled)).toBe(false);
    expect(shouldHardFallback(usage(99_000), disabled)).toBe(false);
  });
});

describe("budget — applyEnvOverride", () => {
  it("parses every supported env key", () => {
    const override = applyEnvOverride({
      NANO_AGENT_COMPACT_SOFT_TRIGGER_PCT: "0.8",
      NANO_AGENT_COMPACT_HARD_FALLBACK_PCT: "0.99",
      NANO_AGENT_COMPACT_MIN_HEADROOM_TOKENS: "10000",
      NANO_AGENT_COMPACT_BACKGROUND_TIMEOUT_MS: "20000",
      NANO_AGENT_COMPACT_MAX_RETRIES_AFTER_FAILURE: "2",
      NANO_AGENT_COMPACT_DISABLED: "true",
    });
    expect(override).toEqual({
      softTriggerPct: 0.8,
      hardFallbackPct: 0.99,
      minHeadroomTokensForBackground: 10_000,
      backgroundTimeoutMs: 20_000,
      maxRetriesAfterFailure: 2,
      disabled: true,
    });
  });

  it("ignores invalid values and warns when callback is supplied", () => {
    const warns: string[] = [];
    const override = applyEnvOverride(
      {
        NANO_AGENT_COMPACT_SOFT_TRIGGER_PCT: "notanumber",
        NANO_AGENT_COMPACT_HARD_FALLBACK_PCT: "1.5",
        NANO_AGENT_COMPACT_MIN_HEADROOM_TOKENS: "-3",
      },
      { onWarn: (m) => warns.push(m) },
    );
    expect(override).toEqual({});
    expect(warns.some((m) => m.includes("HARD_FALLBACK_PCT"))).toBe(true);
    expect(warns.some((m) => m.includes("MIN_HEADROOM_TOKENS"))).toBe(true);
  });

  it("composes with mergeCompactPolicy via spread", () => {
    const merged = mergeCompactPolicy({
      ...applyEnvOverride({
        NANO_AGENT_COMPACT_SOFT_TRIGGER_PCT: "0.6",
      }),
      hardFallbackPct: 0.85,
    });
    expect(merged.softTriggerPct).toBe(0.6);
    expect(merged.hardFallbackPct).toBe(0.85);
  });
});
