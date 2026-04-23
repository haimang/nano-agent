/**
 * A6 Phase 1 P1-03 — Smoke Matrix Inventory.
 *
 * Maps every existing root E2E case to the verification ladder so the
 * pre-A6 assets are *re-classified*, not silently abandoned. The
 * inventory is the registry consumed by `runner.ts` and the gate
 * verdict computer.
 */

import type { LadderLayer } from "../profiles/manifest.js";

export type SmokeRequiredness = "required" | "optional";

export interface SmokeCase {
  /** Unique id used in verdict bundles. */
  readonly id: string;
  /** Where this case fits on the verification ladder. */
  readonly layer: LadderLayer;
  /** Required cases gate the verdict; optional cases only contribute notes. */
  readonly requiredness: SmokeRequiredness;
  /** Profile id from `profiles/manifest.ts`. */
  readonly profileId: string;
  /** Repo-relative source so reviewers can jump in. */
  readonly source: string;
  /** Short human label. */
  readonly label: string;
  /** What this case proves. */
  readonly proves: string;
}

export const SMOKE_INVENTORY: readonly SmokeCase[] = [
  // ── L0 — pre-existing E2E carried forward ──────────────────────
  {
    id: "l0-e2e-05-session-resume",
    layer: "L0",
    requiredness: "required",
    profileId: "local-l0",
    source: "test-legacy/e2e/e2e-05-session-resume.test.mjs",
    label: "Session resume after reconnect (L0)",
    proves:
      "checkpoint+restore preserve session phase / replay buffer when no real network is involved",
  },
  {
    id: "l0-e2e-06-cancel-midturn",
    layer: "L0",
    requiredness: "required",
    profileId: "local-l0",
    source: "test-legacy/e2e/e2e-06-cancel-midturn.test.mjs",
    label: "Mid-turn cancel (L0)",
    proves: "cancel signal aborts the turn cleanly through the orchestrator",
  },
  {
    id: "l0-e2e-09-observability-pipeline",
    layer: "L0",
    requiredness: "required",
    profileId: "local-l0",
    source: "test-legacy/e2e/e2e-09-observability-pipeline.test.mjs",
    label: "Observability pipeline (L0)",
    proves: "trace events flow through the eval-observability pipeline",
  },
  {
    id: "l0-e2e-11-ws-replay-http-fallback",
    layer: "L0",
    requiredness: "required",
    profileId: "local-l0",
    source: "test-legacy/e2e/e2e-11-ws-replay-http-fallback.test.mjs",
    label: "WS replay + HTTP fallback (L0)",
    proves: "fallback path produces the same timeline as the WS path",
  },
  {
    id: "l0-e2e-13-content-replacement-consistency",
    layer: "L0",
    requiredness: "required",
    profileId: "local-l0",
    source: "test-legacy/e2e/e2e-13-content-replacement-consistency.test.mjs",
    label: "Content replacement / prepared artifact (L0)",
    proves: "compact + resume keep prepared-artifact references consistent",
  },
  {
    id: "l0-e2e-14-hooks-resume",
    layer: "L0",
    requiredness: "required",
    profileId: "local-l0",
    source: "test-legacy/e2e/e2e-14-hooks-resume.test.mjs",
    label: "Hooks runtime resume (L0)",
    proves: "registered session hooks survive a checkpoint round-trip",
  },

  // ── L1 — deploy-shaped dry-run smoke ───────────────────────────
  {
    id: "l1-session-edge",
    layer: "L1",
    requiredness: "required",
    profileId: "remote-dev-l1",
    source: "test-legacy/verification/smokes/l1-session-edge.smoke.ts",
    label: "Session edge dry-run (L1)",
    proves:
      "session.start → orchestrator → session.stream.event → resume cycle survives the deploy-shaped boundary",
  },
  {
    id: "l1-external-seams",
    layer: "L1",
    requiredness: "required",
    profileId: "remote-dev-l1",
    source: "test-legacy/verification/smokes/l1-external-seams.smoke.ts",
    label: "External seams dry-run (L1)",
    proves:
      "remote hook + capability + fake provider all complete a round-trip via service-binding",
  },

  // ── L2 — real-boundary smoke ───────────────────────────────────
  {
    id: "l2-real-provider",
    layer: "L2",
    requiredness: "required",
    profileId: "deploy-smoke-l2",
    source: "test-legacy/verification/smokes/l2-real-provider.smoke.ts",
    label: "Real provider golden path (L2)",
    proves:
      "OpenAI-compatible / gpt-4.1-nano returns a deterministic 'OK' response through the real provider seam",
  },
];

/** Filter by layer (e.g. all L1 smoke cases). */
export function smokeForLayer(layer: LadderLayer): readonly SmokeCase[] {
  return SMOKE_INVENTORY.filter((c) => c.layer === layer);
}

/** Required cases for a given layer (used by the verdict computer). */
export function requiredFor(layer: LadderLayer): readonly SmokeCase[] {
  return SMOKE_INVENTORY.filter(
    (c) => c.layer === layer && c.requiredness === "required",
  );
}
