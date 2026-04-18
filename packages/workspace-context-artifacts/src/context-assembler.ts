/**
 * Workspace Context Artifacts — Context Assembler
 *
 * Assembles layered context for LLM requests.
 *
 * Ordering contract (frozen per
 * `docs/action-plan/workspace-context-artifacts.md §4.4 P4-02`):
 *
 *   1. When `config.layers` is non-empty, it is BOTH an allowlist AND
 *      an ordering — layers are emitted in the caller-supplied order
 *      after filtering out kinds not on the list. This is how session
 *      DOs customise per-request assembly.
 *   2. When `config.layers` is empty / absent, the assembler falls
 *      back to `CANONICAL_LAYER_ORDER`
 *      (`system → session → workspace_summary → artifact_summary →
 *      recent_transcript → injected`).
 *   3. Within a single kind, caller-supplied `priority` (lower =
 *      earlier) is the tiebreaker so multiple `injected` layers still
 *      sort deterministically.
 *   4. `required` layers are always included (subject to allowlist).
 *      Budget-based truncation only drops non-required layers.
 */

import {
  CANONICAL_LAYER_ORDER,
  CANONICAL_LAYER_RANK,
} from "./context-layers.js";
import type { ContextAssemblyConfig, ContextLayer, ContextLayerKind } from "./context-layers.js";
import {
  buildAssemblyEvidence,
  type EvidenceAnchorLike,
  type EvidenceSinkLike,
} from "./evidence-emitters.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Assembly Result
// ═══════════════════════════════════════════════════════════════════

export interface AssemblyResult {
  readonly assembled: ContextLayer[];
  readonly totalTokens: number;
  readonly truncated: boolean;
  /**
   * The ordering actually applied to the output — either the
   * caller-supplied `config.layers` (when non-empty) or
   * `CANONICAL_LAYER_ORDER` as the default freeze.
   */
  readonly orderApplied: readonly ContextLayerKind[];
}

// ═══════════════════════════════════════════════════════════════════
// §2 — ContextAssembler
// ═══════════════════════════════════════════════════════════════════

/**
 * A6-A7 review GPT R4 / Kimi R3: optional injection points so the
 * assembler can emit an `assembly` evidence record every time it
 * returns. Both fields are optional to preserve existing call sites
 * that don't supply evidence wiring.
 */
export interface ContextAssemblerOptions {
  readonly evidenceSink?: EvidenceSinkLike;
  readonly evidenceAnchor?: () => EvidenceAnchorLike | undefined;
}

export class ContextAssembler {
  constructor(
    private config: ContextAssemblyConfig,
    private evidenceOpts: ContextAssemblerOptions = {},
  ) {}

  /**
   * A6-A7 review GPT R4: late-bind evidence wiring so callers that
   * already held a ContextAssembler reference (session runtime,
   * tests) can enable emission without constructing a fresh instance.
   */
  setEvidenceWiring(opts: ContextAssemblerOptions): void {
    this.evidenceOpts = { ...this.evidenceOpts, ...opts };
  }

  /**
   * Assemble layered context for an LLM request. See the module
   * header for the frozen ordering contract.
   */
  assemble(layers: ContextLayer[]): AssemblyResult {
    const budget = this.config.maxTokens - this.config.reserveForResponse;

    // 1. Pick the ordering: caller-supplied layers = allowlist AND
    //    order; empty/absent = CANONICAL_LAYER_ORDER.
    const callerOrder =
      this.config.layers && this.config.layers.length > 0
        ? [...this.config.layers]
        : null;
    const orderApplied: ContextLayerKind[] =
      callerOrder !== null ? callerOrder : [...CANONICAL_LAYER_ORDER];
    const allowedSet = new Set<ContextLayerKind>(orderApplied);

    // Index of each kind in the applied order, for stable sorting.
    const orderIndex: Record<ContextLayerKind, number> = Object.fromEntries(
      CANONICAL_LAYER_ORDER.map((k) => [k, Number.POSITIVE_INFINITY]),
    ) as Record<ContextLayerKind, number>;
    orderApplied.forEach((kind, idx) => {
      orderIndex[kind] = idx;
    });

    // 2. Filter by allowlist
    const eligible = layers.filter((l) => allowedSet.has(l.kind));

    // 3. Sort by (applied-order-index, caller priority, canonical rank).
    //    Applied-order-index drives the kind ordering; priority breaks
    //    ties within the same kind; canonical rank is a final tiebreaker.
    const sorted = eligible.sort((a, b) => {
      const byOrder = orderIndex[a.kind] - orderIndex[b.kind];
      if (byOrder !== 0) return byOrder;
      const byPriority = a.priority - b.priority;
      if (byPriority !== 0) return byPriority;
      return CANONICAL_LAYER_RANK[a.kind] - CANONICAL_LAYER_RANK[b.kind];
    });

    const required = sorted.filter((l) => l.required);
    const optional = sorted.filter((l) => !l.required);

    const assembled: ContextLayer[] = [];
    let totalTokens = 0;
    let truncated = false;

    // Always include required layers that survived the allowlist.
    for (const layer of required) {
      assembled.push(layer);
      totalTokens += layer.tokenEstimate;
    }

    if (totalTokens > budget) {
      truncated = true;
    }

    // Add optional layers in applied order while budget allows.
    for (const layer of optional) {
      if (totalTokens + layer.tokenEstimate <= budget) {
        assembled.push(layer);
        totalTokens += layer.tokenEstimate;
      } else {
        truncated = true;
      }
    }

    const result: AssemblyResult = { assembled, totalTokens, truncated, orderApplied };

    // A6-A7 review GPT R4 / Kimi R3: when the caller has supplied
    // `evidenceSink + evidenceAnchor`, publish an `assembly` evidence
    // record for this assemble() call. `consideredKinds` is the
    // allowlist (what the assembler considered); `buildAssemblyEvidence`
    // then computes `dropped = considered − assembled`. When the anchor
    // provider returns undefined (no trace identity latched yet), emit
    // is skipped so we never publish a partial anchor.
    const anchor = this.evidenceOpts.evidenceAnchor?.();
    if (this.evidenceOpts.evidenceSink && anchor) {
      void this.evidenceOpts.evidenceSink.emit(
        buildAssemblyEvidence(anchor, {
          result,
          consideredKinds: orderApplied,
        }),
      );
    }

    return result;
  }
}
