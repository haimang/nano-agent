/**
 * @nano-agent/hooks — hook outcome types and aggregation.
 *
 * After one or more handlers run for a hook event, their individual outcomes
 * are merged into an AggregatedHookOutcome that the dispatcher uses to decide
 * whether to continue, block, or stop the agent loop.
 *
 * Aggregation rules (locked by `catalog.ts` per-event allowlists):
 *   - "stop" wins over "block" wins over "continue" (strictest-wins).
 *   - Outcome actions not in the event's allowedOutcomes list are demoted
 *     to "continue" (the handler's diagnostics are still preserved).
 *   - `updatedInput` is only honoured when the event's allowedOutcomes list
 *     contains `"updatedInput"` (today: `PreToolUse` only). The LAST
 *     non-undefined `updatedInput` wins — later handlers refine what
 *     earlier handlers produced. Outside that event it is silently dropped.
 *   - `additionalContext` strings are concatenated with newlines.
 *   - `diagnostics` objects are shallow-merged (later handlers overwrite keys).
 */

import { HOOK_EVENT_CATALOG } from "./catalog.js";
import type { HookEventName } from "./catalog.js";

/** The action a single handler outcome requests. */
export type HookOutcomeAction = "continue" | "block" | "stop";

/** The result returned by a single hook handler. */
export interface HookOutcome {
  readonly action: HookOutcomeAction;
  readonly updatedInput?: unknown;
  readonly additionalContext?: string;
  readonly diagnostics?: Record<string, unknown>;
  readonly handlerId: string;
  readonly durationMs: number;
}

/** The merged result of all handler outcomes for a single event dispatch. */
export interface AggregatedHookOutcome {
  readonly finalAction: HookOutcomeAction;
  readonly outcomes: readonly HookOutcome[];
  readonly blocked: boolean;
  readonly blockReason?: string;
  readonly updatedInput?: unknown;
  readonly mergedContext?: string;
  readonly mergedDiagnostics?: Record<string, unknown>;
}

/**
 * Merge multiple handler results into a single aggregated outcome.
 *
 * See the module doc for the full rule list.
 */
export function aggregateOutcomes(
  outcomes: readonly HookOutcome[],
  eventName: HookEventName,
): AggregatedHookOutcome {
  const meta = HOOK_EVENT_CATALOG[eventName];
  const allowed = new Set(meta.allowedOutcomes);

  let finalAction: HookOutcomeAction = "continue";
  let blockReason: string | undefined;
  const contextParts: string[] = [];
  let mergedDiagnostics: Record<string, unknown> | undefined;
  let updatedInput: unknown | undefined;
  let updatedInputSet = false;

  for (const outcome of outcomes) {
    // Only honour "block" / "stop" if the event catalog allows it.
    const effectiveAction = isActionAllowed(outcome.action, allowed)
      ? outcome.action
      : "continue";

    // Strictest-wins: stop > block > continue
    if (actionPriority(effectiveAction) > actionPriority(finalAction)) {
      finalAction = effectiveAction;
      if (effectiveAction === "block") {
        blockReason = outcome.additionalContext ?? `Blocked by handler ${outcome.handlerId}`;
      }
    }

    // Merge updatedInput — only for events whose allowlist contains it.
    // Last-non-undefined wins so later refinements win over earlier ones.
    if (outcome.updatedInput !== undefined && allowed.has("updatedInput")) {
      updatedInput = outcome.updatedInput;
      updatedInputSet = true;
    }

    // Merge additional context
    if (outcome.additionalContext && allowed.has("additionalContext")) {
      contextParts.push(outcome.additionalContext);
    }

    // Merge diagnostics
    if (outcome.diagnostics && allowed.has("diagnostics")) {
      mergedDiagnostics = { ...(mergedDiagnostics ?? {}), ...outcome.diagnostics };
    }
  }

  return {
    finalAction,
    outcomes,
    blocked: finalAction === "block" || finalAction === "stop",
    blockReason,
    updatedInput: updatedInputSet ? updatedInput : undefined,
    mergedContext: contextParts.length > 0 ? contextParts.join("\n") : undefined,
    mergedDiagnostics,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────

function actionPriority(action: HookOutcomeAction): number {
  switch (action) {
    case "continue":
      return 0;
    case "block":
      return 1;
    case "stop":
      return 2;
  }
}

function isActionAllowed(action: HookOutcomeAction, allowedOutcomes: Set<string>): boolean {
  if (action === "continue") return true;
  return allowedOutcomes.has(action);
}
