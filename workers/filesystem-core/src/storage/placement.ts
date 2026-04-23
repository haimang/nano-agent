/**
 * Storage Topology — Provisional Placement Hypotheses.
 *
 * Translates the `DATA_ITEM_CATALOG` into placement hypotheses that
 * pair each data item with its concrete storage backend and document:
 *
 *   - when/why the placement should be revisited, and
 *   - how the item relates to the MIME-type gate in `mime-gate.ts`.
 *
 * All hypotheses start as provisional. They move to evidence-backed
 * only after `eval-observability` confirms the hypothesis with real
 * `StoragePlacementLog` data.
 */

import type { DataItemClass } from "./data-items.js";
import type { StorageBackend } from "./taxonomy.js";
import { DATA_ITEM_CATALOG } from "./data-items.js";
import { storageClassToBackend } from "./taxonomy.js";
import type { MimePolicyDecision, MimePolicyInput, MimePolicyResult } from "./mime-gate.js";
import { applyMimePolicy } from "./mime-gate.js";

/**
 * How a placement hypothesis relates to the MIME-type gate in
 * `mime-gate.ts`:
 *
 *   - `gated-by-mime`         : before accepting a new payload under
 *                               this hypothesis, `applyMimePolicy()`
 *                               MUST run and its decision
 *                               (`inline | signed-url | prepared-text
 *                               | reject`) is the binding input.
 *   - `workspace-delegated`   : MIME gate is applied by the workspace
 *                               package (workspace files, prepared
 *                               artifacts). Storage-topology does NOT
 *                               re-gate here — it delegates.
 *   - `not-applicable`        : the data item does not carry a MIME
 *                               payload (control state, counters,
 *                               seqs …). Skip the gate entirely.
 */
export type PlacementMimeGate =
  | "gated-by-mime"
  | "workspace-delegated"
  | "not-applicable";

/** A placement hypothesis linking a data item to a storage backend. */
export interface PlacementHypothesis {
  readonly dataItem: DataItemClass;
  readonly storageBackend: StorageBackend;
  readonly provisional: boolean;
  readonly revisitCondition: string;
  readonly revisitRationale: string;
  /**
   * How `applyMimePolicy()` relates to this placement. See
   * `PlacementMimeGate` for the three documented positions. Callers
   * MUST honour this field before writing through the placement —
   * `enforceMimeGate()` is the minimal helper for that check.
   */
  readonly mimeGate: PlacementMimeGate;
}

/**
 * Default MIME-gate classification per `DataItemClass`. Reviewers can
 * inspect this table alongside `PLACEMENT_HYPOTHESES` to see at a
 * glance which items are gated, delegated, or opt-out.
 */
export function defaultMimeGate(item: DataItemClass): PlacementMimeGate {
  switch (item) {
    // Workspace / artifact items: the workspace package owns the gate.
    case "workspace-file-small":
    case "workspace-file-large":
    case "attachment":
      return "workspace-delegated";

    // Items that can carry user-controlled MIME payloads; require
    // `applyMimePolicy()` before a write goes through.
    case "compact-archive":
    case "session-transcript":
    case "audit-trail":
    case "audit-archive":
    case "system-prompt":
      return "gated-by-mime";

    // Control state / counters / ambient config — no MIME payload.
    case "session-phase":
    case "session-messages":
    case "replay-buffer":
    case "stream-seqs":
    case "tool-inflight":
    case "hooks-config":
    case "provider-config":
    case "model-registry":
    case "skill-manifest":
    case "hooks-policy":
    case "feature-flags":
      return "not-applicable";
  }
}

/**
 * Pre-populated placement hypotheses derived from the `DATA_ITEM_CATALOG`.
 *
 * Each catalog entry is mapped to a `PlacementHypothesis` using:
 *   - `storageClassToBackend(storageClass)` for the concrete backend
 *   - `provisionalMarker !== "frozen"` to determine the provisional flag
 *   - `revisitCondition` from the catalog entry
 *   - `displayName` as the revisit rationale context
 *   - `defaultMimeGate(item)` for the MIME-gate position
 */
export const PLACEMENT_HYPOTHESES: ReadonlyMap<DataItemClass, PlacementHypothesis> = (() => {
  const map = new Map<DataItemClass, PlacementHypothesis>();

  for (const [itemClass, descriptor] of Object.entries(DATA_ITEM_CATALOG)) {
    const dataItem = itemClass as DataItemClass;
    map.set(dataItem, {
      dataItem,
      storageBackend: storageClassToBackend(descriptor.storageClass),
      provisional: descriptor.provisionalMarker !== "frozen",
      revisitCondition: descriptor.revisitCondition,
      revisitRationale: descriptor.displayName,
      mimeGate: defaultMimeGate(dataItem),
    });
  }

  return map;
})();

/**
 * Look up the placement hypothesis for a data item.
 * Returns `undefined` if the item is not in the catalog.
 */
export function getPlacement(item: DataItemClass): PlacementHypothesis | undefined {
  return PLACEMENT_HYPOTHESES.get(item);
}

/**
 * Result of enforcing the MIME gate on a candidate write.
 *
 * `allowed = true` means the gate was satisfied — either because it
 * does not apply, or because the returned `decision` accepted the
 * payload. `allowed = false` carries the gate reason so callers can
 * surface it back to the LLM / audit.
 */
export type EnforceMimeGateResult =
  | {
      readonly allowed: true;
      readonly gate: PlacementMimeGate;
      readonly decision?: MimePolicyDecision;
      readonly mimePolicy?: MimePolicyResult;
    }
  | {
      readonly allowed: false;
      readonly gate: "gated-by-mime";
      readonly decision: MimePolicyDecision;
      readonly mimePolicy: MimePolicyResult;
      readonly reason: string;
    };

/**
 * Run the MIME gate for a placement according to its `mimeGate`
 * field. This is the single seam session-do-runtime / workspace
 * callers should use so they do not have to re-implement the
 * gated-vs-delegated vs not-applicable decision themselves.
 *
 *   - `not-applicable`      → always allowed, no gate runs.
 *   - `workspace-delegated` → allowed; caller (workspace package)
 *                             runs its own gate.
 *   - `gated-by-mime`       → require `input`; run `applyMimePolicy()`
 *                             and translate the decision into allow/deny.
 *                             `reject` decisions turn into `allowed:false`.
 */
export function enforceMimeGate(
  placement: PlacementHypothesis,
  input?: MimePolicyInput,
): EnforceMimeGateResult {
  if (placement.mimeGate !== "gated-by-mime") {
    return { allowed: true, gate: placement.mimeGate };
  }
  if (!input) {
    return {
      allowed: false,
      gate: "gated-by-mime",
      decision: "reject",
      mimePolicy: {
        decision: "reject",
        reason:
          `placement for "${placement.dataItem}" is gated-by-mime but caller supplied no MIME input`,
        thresholdBytes: 0,
      },
      reason: "gated-by-mime placement requires a MIME input",
    };
  }
  const decision = applyMimePolicy(input);
  if (decision.decision === "reject") {
    return {
      allowed: false,
      gate: "gated-by-mime",
      decision: decision.decision,
      mimePolicy: decision,
      reason: decision.reason,
    };
  }
  return {
    allowed: true,
    gate: "gated-by-mime",
    decision: decision.decision,
    mimePolicy: decision,
  };
}
