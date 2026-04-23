/**
 * Context-Management — async-compact CompactionScheduler.
 *
 * Pure state-machine helper: given the current `CompactState` and a
 * fresh `UsageSnapshot`, decide what transition (if any) the
 * orchestrator should perform NOW.
 *
 * Per `PX-async-compact-lifecycle-spec.md §2.2`:
 *
 *   idle      ──→ armed       (token usage > SOFT_THRESHOLD)
 *   armed     ──→ preparing   (next idle window)
 *   armed     ──→ committing  (HARD_THRESHOLD before prepare started)
 *   preparing ──→ committing  (summary ready + turn boundary)
 *   preparing ──→ committing  (HARD_THRESHOLD during prepare)
 *   committing ──→ committed  (atomic swap success)
 *   committing ──→ failed     (DO transaction throw)
 *   committed ──→ idle        (PostCompact returned)
 *   failed    ──→ idle        (after retry exhausted)
 *
 * The scheduler does NOT execute transitions — it returns a decision
 * the orchestrator carries out. This keeps the state machine
 * inspectable and unit-testable in isolation.
 */

import type { CompactPolicy, UsageSnapshot } from "../budget/index.js";
import { computeThreshold } from "./threshold.js";
import type { CompactState } from "./types.js";

export type SchedulerDecision =
  | { kind: "noop" }
  | { kind: "arm"; reason: "soft-threshold-crossed" }
  | { kind: "prepare"; reason: "armed-and-idle-window" }
  | { kind: "commit-prepared"; reason: "summary-ready-at-boundary" }
  | { kind: "force-sync-fallback"; reason: "hard-threshold-no-prepared" };

export interface SchedulerInput {
  readonly state: CompactState;
  readonly usage: UsageSnapshot;
  readonly policy: CompactPolicy;
  /** True when caller is at a safe turn boundary (not mid-tool-call). */
  readonly atTurnBoundary: boolean;
  /** True when the prepare job has produced a `PreparedSummary`. */
  readonly preparedReady: boolean;
}

export class CompactionScheduler {
  decide(input: SchedulerInput): SchedulerDecision {
    const { state, usage, policy, atTurnBoundary, preparedReady } = input;

    if (policy.disabled) {
      return { kind: "noop" };
    }

    const threshold = computeThreshold(usage, policy);

    // HARD threshold beats everything else — sync fallback wins.
    // (Except when a prepared summary is already ready: prefer the
    // already-paid-for prepared summary, commit it now.)
    if (threshold.shouldHardFallback) {
      if (preparedReady && atTurnBoundary && state.kind === "preparing") {
        return { kind: "commit-prepared", reason: "summary-ready-at-boundary" };
      }
      // For any state without a ready prepared summary, the
      // orchestrator must run the synchronous fallback path.
      if (state.kind !== "committing" && state.kind !== "committed") {
        return {
          kind: "force-sync-fallback",
          reason: "hard-threshold-no-prepared",
        };
      }
    }

    switch (state.kind) {
      case "idle":
        if (threshold.shouldArm) {
          return { kind: "arm", reason: "soft-threshold-crossed" };
        }
        return { kind: "noop" };

      case "armed":
        if (atTurnBoundary) {
          return { kind: "prepare", reason: "armed-and-idle-window" };
        }
        return { kind: "noop" };

      case "preparing":
        if (preparedReady && atTurnBoundary) {
          return { kind: "commit-prepared", reason: "summary-ready-at-boundary" };
        }
        return { kind: "noop" };

      case "committing":
      case "committed":
      case "failed":
      default:
        return { kind: "noop" };
    }
  }
}
