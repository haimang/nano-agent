/**
 * Context-Management — Budget defaults + merge / threshold helpers.
 *
 * Defaults trace back to `PX-async-compact-lifecycle-spec.md §3.1`:
 *   - SOFT_COMPACT_TRIGGER_PCT = 0.75
 *   - HARD_COMPACT_FALLBACK_PCT = 0.95
 *   - MIN_HEADROOM_TOKENS_FOR_BACKGROUND = 5_000
 *   - BACKGROUND_TIMEOUT_MS = 30_000
 *   - MAX_RETRIES_AFTER_FAILURE = 1
 */

import type {
  BufferPolicy,
  CompactPolicy,
  CompactPolicyOverride,
  UsageSnapshot,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Defaults
// ═══════════════════════════════════════════════════════════════════

/** Frozen defaults — keep in sync with PX spec §3.1. */
export const DEFAULT_COMPACT_POLICY: CompactPolicy = Object.freeze({
  softTriggerPct: 0.75,
  hardFallbackPct: 0.95,
  minHeadroomTokensForBackground: 5_000,
  backgroundTimeoutMs: 30_000,
  maxRetriesAfterFailure: 1,
  disabled: false,
});

// ═══════════════════════════════════════════════════════════════════
// §2 — Merge override into defaults
// ═══════════════════════════════════════════════════════════════════

/**
 * Merge a per-session override into the canonical defaults.
 *
 * Validation rules (throw on violation — these would be silent
 * footguns at runtime):
 *   - 0 < softTriggerPct < hardFallbackPct ≤ 1
 *   - minHeadroomTokensForBackground ≥ 0
 *   - backgroundTimeoutMs ≥ 0
 *   - maxRetriesAfterFailure ≥ 0
 */
export function mergeCompactPolicy(
  override?: CompactPolicyOverride,
  defaults: CompactPolicy = DEFAULT_COMPACT_POLICY,
): CompactPolicy {
  const merged: CompactPolicy = {
    softTriggerPct: override?.softTriggerPct ?? defaults.softTriggerPct,
    hardFallbackPct: override?.hardFallbackPct ?? defaults.hardFallbackPct,
    minHeadroomTokensForBackground:
      override?.minHeadroomTokensForBackground ??
      defaults.minHeadroomTokensForBackground,
    backgroundTimeoutMs:
      override?.backgroundTimeoutMs ?? defaults.backgroundTimeoutMs,
    maxRetriesAfterFailure:
      override?.maxRetriesAfterFailure ?? defaults.maxRetriesAfterFailure,
    disabled: override?.disabled ?? defaults.disabled,
  };

  if (
    merged.softTriggerPct <= 0 ||
    merged.softTriggerPct >= 1 ||
    merged.hardFallbackPct <= 0 ||
    merged.hardFallbackPct > 1 ||
    merged.softTriggerPct >= merged.hardFallbackPct
  ) {
    throw new Error(
      `mergeCompactPolicy: invalid threshold pair (soft=${merged.softTriggerPct}, hard=${merged.hardFallbackPct}); require 0 < soft < hard ≤ 1`,
    );
  }
  if (merged.minHeadroomTokensForBackground < 0) {
    throw new Error("mergeCompactPolicy: minHeadroomTokensForBackground must be >= 0");
  }
  if (merged.backgroundTimeoutMs < 0) {
    throw new Error("mergeCompactPolicy: backgroundTimeoutMs must be >= 0");
  }
  if (merged.maxRetriesAfterFailure < 0) {
    throw new Error("mergeCompactPolicy: maxRetriesAfterFailure must be >= 0");
  }

  return merged;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Threshold helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Effective prompt budget for a given `BufferPolicy`. Mirrors the
 * `ContextAssemblyConfig` calculation `maxTokens - reserveForResponse`.
 */
export function effectivePromptBudget(buffer: BufferPolicy): number {
  return Math.max(0, buffer.hardLimitTokens - buffer.responseReserveTokens);
}

/**
 * Token usage as a fraction of the prompt budget (0..1+; values > 1
 * mean the prompt has already overflowed the response-reserve, which
 * the assembler will surface via `truncated`).
 */
export function usagePct(snapshot: UsageSnapshot): number {
  const budget = Math.max(0, snapshot.maxTokens - snapshot.responseReserveTokens);
  if (budget === 0) return Number.POSITIVE_INFINITY;
  return snapshot.totalTokens / budget;
}

/**
 * Free headroom (in tokens) available before the prompt budget is hit.
 * Used by the scheduler's `minHeadroomTokensForBackground` guard.
 */
export function headroomTokens(snapshot: UsageSnapshot): number {
  const budget = effectivePromptBudget({
    hardLimitTokens: snapshot.maxTokens,
    responseReserveTokens: snapshot.responseReserveTokens,
  });
  return Math.max(0, budget - snapshot.totalTokens);
}

/** Threshold predicates used by `async-compact/scheduler.ts`. */
export function shouldArm(snapshot: UsageSnapshot, policy: CompactPolicy): boolean {
  if (policy.disabled) return false;
  if (headroomTokens(snapshot) < policy.minHeadroomTokensForBackground) return false;
  return usagePct(snapshot) >= policy.softTriggerPct;
}

export function shouldHardFallback(
  snapshot: UsageSnapshot,
  policy: CompactPolicy,
): boolean {
  if (policy.disabled) return false;
  return usagePct(snapshot) >= policy.hardFallbackPct;
}
