/**
 * Context-Management — async-compact threshold helpers.
 *
 * Thin wrapper that re-exports the budget-side `shouldArm` /
 * `shouldHardFallback` predicates so async-compact callers do not
 * need to import two submodules. Kept as its own file so the
 * orchestrator's `tryArm` / `tryCommit` paths read clearly without
 * cross-submodule jumps.
 */

import {
  shouldArm,
  shouldHardFallback,
  headroomTokens,
  usagePct,
} from "../budget/index.js";
import type { CompactPolicy, UsageSnapshot } from "../budget/index.js";

export interface ThresholdDecision {
  readonly shouldArm: boolean;
  readonly shouldHardFallback: boolean;
  readonly usagePct: number;
  readonly headroomTokens: number;
}

export function computeThreshold(
  snapshot: UsageSnapshot,
  policy: CompactPolicy,
): ThresholdDecision {
  return {
    shouldArm: shouldArm(snapshot, policy),
    shouldHardFallback: shouldHardFallback(snapshot, policy),
    usagePct: usagePct(snapshot),
    headroomTokens: headroomTokens(snapshot),
  };
}
