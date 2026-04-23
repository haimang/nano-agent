/**
 * @nano-agent/hooks — package-local permission verdict helpers.
 *
 * Background (B5 action-plan §2.3 override of P4 §8.5):
 *
 *   The P4 design originally wanted `PermissionRequest` to accept
 *   `allow` / `deny` outcome actions. The NACP-Core `hook.outcome`
 *   wire body, however, does NOT carry those fields — it has
 *   `ok / block / stop / updated_input / additional_context / diagnostics`.
 *
 *   B5 resolves this without inventing new wire fields: `PermissionRequest`
 *   handlers express their verdict with the existing actions, and we
 *   interpret them here:
 *
 *     continue         → allow   (ok === true, no block)
 *     block { reason } → deny    (ok === false, block present)
 *     zero handlers    → deny    (fail-closed at the caller)
 *
 *   This module is the single source-of-truth for that translation so
 *   `capability-runtime` (the producer) and any consumer doesn't grow
 *   ad-hoc verdict-reading code.
 */

import type { HookEventName } from "./catalog.js";
import type { AggregatedHookOutcome } from "./outcome.js";

/**
 * Package-local permission verdict. Consumers (e.g. `capability-runtime`)
 * use this alias; it is NEVER serialized into wire bodies.
 */
export type PermissionVerdict = "allow" | "deny";

/**
 * Resolve the aggregated outcome of a `PermissionRequest` dispatch into
 * an `allow` / `deny` verdict. Fails closed:
 *
 *   - `outcomes.length === 0`       → `"deny"`
 *   - `finalAction === "block"`     → `"deny"`
 *   - `finalAction === "stop"`      → `"deny"`   (shouldn't happen — stop
 *                                                  isn't in allowedOutcomes —
 *                                                  but defensively
 *                                                  fail-closed)
 *   - `finalAction === "continue"`  → `"allow"`
 *
 * This helper does NOT check the caller-supplied `eventName`; callers
 * typically guard with `if (eventName === "PermissionRequest")` before
 * calling in. Exported signature keeps the eventName for readability
 * (and possible future use if other events want an allow/deny shape).
 */
export function verdictOf(
  outcome: AggregatedHookOutcome,
  eventName?: HookEventName,
): PermissionVerdict {
  void eventName;
  if (outcome.outcomes.length === 0) return "deny";
  if (outcome.finalAction === "continue") return "allow";
  return "deny";
}

/**
 * The reason carried back to the caller when the verdict is `deny`.
 * Prefers `blockReason` (set by the first blocking handler) then
 * falls back to the fail-closed label.
 */
export function denyReason(outcome: AggregatedHookOutcome): string {
  if (outcome.outcomes.length === 0) {
    return "no-handler-fail-closed";
  }
  return outcome.blockReason ?? "denied-by-handler";
}
