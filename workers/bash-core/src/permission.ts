/**
 * Capability Permission Authorizer — hook producer seam.
 *
 * B5 introduction: the `PermissionRequest` / `PermissionDenied` hook
 * events need a real producer. This module defines the **optional**
 * authorizer interface the executor calls when the static policy
 * decision is `"ask"`. If no authorizer is injected, the executor's
 * behavior is unchanged (returns a `policy-ask` error as before).
 *
 * Wire truth (per B5 action-plan §2.3 override of P4 §8.5):
 *
 *   - PermissionRequest handlers vote with the existing wire actions:
 *     `continue` (= allow), `block` (= deny). No new wire fields.
 *   - Zero handlers OR any block handler ⇒ verdict = `deny`.
 *   - All handlers `continue` ⇒ verdict = `allow`.
 *   - On `deny`, the authorizer is expected to ALSO emit the
 *     observational `PermissionDenied` event so consumers get the
 *     post-decision notification without a second round-trip.
 *
 * The authorizer is intentionally hook-library-agnostic: it accepts
 * a typed context and returns a typed verdict. `session-do-runtime`
 * (or any other host) wires it up by constructing a hook-backed
 * implementation via `@nano-agent/hooks`'s `HookDispatcher`.
 */

import type { CapabilityPlan } from "./types.js";

/** Verdict returned by the authorizer after a PermissionRequest dispatch. */
export type PermissionVerdict = "allow" | "deny";

/** Decision record — what happened + why (for audit / logging). */
export interface PermissionDecision {
  readonly verdict: PermissionVerdict;
  /** Handler count that participated in the decision. */
  readonly handlerCount: number;
  /** Reason surfaced when verdict === "deny". */
  readonly reason?: string;
  /** Handler id that blocked, when known. */
  readonly deniedBy?: string;
}

/** Minimal authorizer context — kept narrow so the seam stays cheap. */
export interface PermissionRequestContext {
  readonly plan: CapabilityPlan;
  /** Stable request id — echoed back in the executor response. */
  readonly requestId: string;
  /** Optional carriers for cross-seam observability. */
  readonly sessionUuid?: string;
  readonly turnUuid?: string;
  readonly traceUuid?: string;
}

/**
 * Optional authorizer seam. A host that wants `PermissionRequest` /
 * `PermissionDenied` hooks to have a real producer injects an
 * implementation here; the executor delegates ask-gated decisions to it.
 */
export interface CapabilityPermissionAuthorizer {
  authorize(context: PermissionRequestContext): Promise<PermissionDecision>;
}
