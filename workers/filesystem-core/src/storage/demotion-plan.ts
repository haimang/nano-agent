/**
 * Storage Topology — Demotion Plan Contracts.
 *
 * Defines when data moves from a warmer tier to a colder tier
 * (e.g., DO storage -> KV, DO storage -> R2). Demotions are
 * triggered by staleness, size thresholds, or session lifecycle events.
 */

import type { StorageBackend } from "./taxonomy.js";

/** A demotion plan describing a hot/warm -> colder data movement. */
export interface DemotionPlan {
  readonly trigger: string;
  readonly from: StorageBackend;
  readonly to: StorageBackend;
  readonly description: string;
}

/**
 * Pre-defined demotion plans for the v1 storage topology.
 */
export const DEMOTION_PLANS: readonly DemotionPlan[] = [
  {
    trigger: "compact — old turns evicted from DO storage after compaction",
    from: "do-storage",
    to: "r2",
    description:
      "After compaction, turns that exceeded the context window budget are archived from DO storage to R2.",
  },
  {
    trigger: "session.end — session state flushed to cold storage",
    from: "do-storage",
    to: "r2",
    description:
      "On session end, the full transcript and audit trail are demoted from DO storage to R2 for long-term retention.",
  },
  {
    // NOTE: the byte cut-off is PROVISIONAL — see
    // `DEFAULT_DO_SIZE_THRESHOLD_BYTES` in `calibration.ts`. The plan
    // only names the condition class; the actual threshold is supplied
    // by the calibration layer and is meant to be tuned with evidence.
    trigger: "workspace.file.oversize — file exceeds the provisional DO-storage inline cut-off",
    from: "do-storage",
    to: "r2",
    description:
      "Workspace files exceeding the provisional inline threshold (see calibration.ts) are " +
      "demoted from DO storage to R2. A reference pointer remains in DO storage.",
  },
  {
    trigger: "audit.rotation — audit trail exceeds daily size threshold",
    from: "do-storage",
    to: "r2",
    description:
      "Audit trail segments are periodically demoted from DO storage to R2 to keep hot-tier storage bounded.",
  },
];
