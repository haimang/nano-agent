/**
 * Re-validation — context-management (B4) shipped seam.
 *
 * What Round 1 did NOT cover: `@nano-agent/context-management` was
 * shipped in B4 after the Round 1 spike. B7 validates that the
 * async-compact lifecycle event names + budget policy contract are
 * consumable by a round-2 integrated spike worker without round-
 * trip through `session-do-runtime`.
 *
 * This module lights up:
 *   - `shouldArm` / `shouldHardFallback` — budget policy decisions
 *   - `COMPACT_LIFECYCLE_EVENT_NAMES` — lifecycle catalog (locked by
 *     `test/hooks-protocol-contract.test.mjs` on the hooks side; here
 *     we just confirm the names import cleanly and resolve to strings)
 *   - `noopLifecycleEmitter` — emitter seam is instantiable
 *
 * We intentionally do NOT run the orchestrator here — that requires
 * LLM summarize providers and is the next phase's concern (B8
 * worker-matrix). This is a seam-presence check, not a full run.
 */

import {
  COMPACT_LIFECYCLE_EVENT_NAMES,
  DEFAULT_COMPACT_POLICY,
  noopLifecycleEmitter,
  shouldArm,
  shouldHardFallback,
  type UsageSnapshot,
} from "@nano-agent/context-management";
import {
  makeIntegratedResult,
  type IntegratedProbeResult,
} from "../result-shape.js";

export interface ContextReValidationDeps {
  readonly mode: "local" | "live";
}

const MAX_TOKENS = 200_000;
const RESERVE_TOKENS = 8_000;

function mkUsage(totalTokens: number): UsageSnapshot {
  return {
    totalTokens,
    maxTokens: MAX_TOKENS,
    responseReserveTokens: RESERVE_TOKENS,
    categories: [],
  };
}

export async function probeContextReValidation(
  deps: ContextReValidationDeps,
): Promise<IntegratedProbeResult> {
  const start = Date.now();

  // 1. Budget policy decisions — at low utilization should NOT arm.
  const effective = MAX_TOKENS - RESERVE_TOKENS;
  const lowUsage = mkUsage(1_000);
  const highUsage = mkUsage(Math.ceil(effective * 0.99));
  const armLow = shouldArm(lowUsage, DEFAULT_COMPACT_POLICY);
  const fallbackHigh = shouldHardFallback(highUsage, DEFAULT_COMPACT_POLICY);

  // 2. Lifecycle catalog — should contain the 5 canonical names.
  const expectedLifecycle = [
    "ContextPressure",
    "ContextCompactArmed",
    "ContextCompactPrepareStarted",
    "ContextCompactCommitted",
    "ContextCompactFailed",
  ];
  const catalogOk = expectedLifecycle.every((name) =>
    COMPACT_LIFECYCLE_EVENT_NAMES.includes(name as (typeof COMPACT_LIFECYCLE_EVENT_NAMES)[number]),
  );

  // 3. Emitter seam is instantiable.
  let emitterOk = true;
  try {
    noopLifecycleEmitter.emit({
      name: "ContextPressure",
      sessionUuid: "00000000-0000-4000-8000-000000000000",
      stateId: "re-validation",
      emittedAt: new Date().toISOString(),
      payload: { reason: "re-validation" },
    });
  } catch {
    emitterOk = false;
  }

  const allOk =
    armLow === false &&
    fallbackHigh === true &&
    catalogOk &&
    emitterOk;

  return makeIntegratedResult("V4-context-async-compact-revalidation", start, {
    findingId: "B4-seam-integration",
    verdict: allOk ? "writeback-shipped" : "still-open",
    success: allOk,
    mode: deps.mode,
    usedPackages: ["@nano-agent/context-management"],
    caveats: [
      "orchestrator run requires an LLM summarizer; that is B8 worker-matrix scope",
      "this probe validates seam presence + basic budget policy, not live compact run",
    ],
    observations: [
      { label: "shouldArm(low)", value: armLow },
      { label: "shouldHardFallback(high)", value: fallbackHigh },
      { label: "catalog-complete", value: catalogOk },
      { label: "emitter-instantiable", value: emitterOk },
      { label: "lifecycle-names", value: Array.from(COMPACT_LIFECYCLE_EVENT_NAMES) },
    ],
    errors: allOk
      ? []
      : [
          {
            code: "context-revalidation-fail",
            message: `armLow=${armLow}, fallbackHigh=${fallbackHigh}, catalog=${catalogOk}, emitter=${emitterOk}`,
            count: 1,
          },
        ],
    evidenceRefs: [
      { kind: "source", locator: "packages/context-management/src/async-compact/" },
    ],
    timings: { samplesN: 4 },
  });
}
