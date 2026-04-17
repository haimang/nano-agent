/**
 * Storage Topology — Promotion Plan Contracts.
 *
 * Defines when data moves from a colder tier to a warmer tier
 * (e.g., R2 -> DO storage, KV -> DO storage). Promotions are
 * typically triggered by access patterns that require lower latency.
 */

import type { StorageBackend } from "./taxonomy.js";

/** A promotion plan describing a cold/warm -> hot data movement. */
export interface PromotionPlan {
  readonly trigger: string;
  readonly from: StorageBackend;
  readonly to: StorageBackend;
  readonly description: string;
}

/**
 * Pre-defined promotion plans for the v1 storage topology.
 */
export const PROMOTION_PLANS: readonly PromotionPlan[] = [
  {
    trigger: "session.resume — compact archive needed for replay",
    from: "r2",
    to: "do-storage",
    description:
      "On session resume, archived compacted turns are loaded from R2 back into DO storage for the active context window.",
  },
  {
    trigger: "session.start — provider config loaded for LLM calls",
    from: "kv",
    to: "do-storage",
    description:
      "Provider configuration is read from KV at session start and cached in DO storage for the session lifetime.",
  },
  {
    trigger: "session.start — model registry snapshot loaded",
    from: "kv",
    to: "do-storage",
    description:
      "Model registry is read from KV at session start and cached in DO storage for model selection during the session.",
  },
  {
    trigger: "tool.call — attachment needed for LLM context",
    from: "r2",
    to: "do-storage",
    description:
      "Attachments stored in R2 are fetched into DO memory when referenced in a tool call or LLM context.",
  },
];
