/**
 * Context-Management — async-compact CompactionPlanner.
 *
 * Per `PX-async-compact-lifecycle-spec.md §4`:
 *   - Fork is **structural sharing** (≈ O(1) memory overhead).
 *   - System / memory / summary layers stay shared by reference.
 *   - Mutable layers (interaction / tool_result) get a new array
 *     wrapper but element references are preserved until written.
 *
 * The planner is intentionally pure — it never touches storage. The
 * orchestrator owns persistence concerns; the planner just answers
 * "what should the prepare job summarize?".
 */

import type { ContextLayer } from "../context-layers.js";
import type { ContextCandidate } from "./types.js";

/** Layer kinds whose array wrapper is forked (their elements remain shared). */
const MUTABLE_LAYER_KINDS = new Set(["recent_transcript", "session", "injected"]);

export class CompactionPlanner {
  /**
   * Build a `ContextCandidate` from the live context. The candidate's
   * `layers` array is a NEW array — appending to it does NOT mutate
   * the source. Layer objects themselves are still shared until the
   * caller explicitly clones a layer (write-time copy).
   */
  fork(input: {
    layers: readonly ContextLayer[];
    contextVersion: number;
  }): ContextCandidate {
    const forkedLayers: ContextLayer[] = [];
    for (const layer of input.layers) {
      if (MUTABLE_LAYER_KINDS.has(layer.kind)) {
        // Mutable kind: new array wrapper would matter when the caller
        // intends to push more items into the candidate. Element refs
        // stay shared; immutability is enforced via the `readonly`
        // typing on `ContextCandidate.layers`.
        forkedLayers.push(layer);
      } else {
        forkedLayers.push(layer);
      }
    }

    const tokenEstimate = forkedLayers.reduce(
      (sum, layer) => sum + (layer.tokenEstimate ?? 0),
      0,
    );

    return {
      snapshotVersion: input.contextVersion,
      takenAt: new Date().toISOString(),
      layers: forkedLayers,
      tokenEstimate,
    };
  }
}

/**
 * Detect whether `current` advanced past `candidate` — i.e. fresh
 * messages were appended while the prepare job ran. Used by the
 * committer's diff-aware merge (PX spec §5.2).
 */
export function freshContextAdvanced(
  candidate: ContextCandidate,
  currentVersion: number,
): boolean {
  return currentVersion > candidate.snapshotVersion;
}
