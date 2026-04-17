/**
 * Storage Taxonomy — the shared vocabulary for nano-agent's hot/warm/cold data tiers.
 *
 * - StorageClass: the semantic tier (hot = per-session low-latency, warm = shared config, cold = archive/large)
 * - StorageBackend: the concrete Cloudflare primitive backing a class
 * - ProvisionalMarker: tracks whether a placement decision is still hypothetical
 * - ResponsibleRuntime: which runtime subsystem owns a given data item
 *
 * All placements start as "provisional" and move to "evidence-backed" only after
 * eval-observability confirms the hypothesis with real read/write/size evidence.
 */

// ── Storage Class ──

export type StorageClass = "hot" | "warm" | "cold";

// ── Storage Backend ──

export type StorageBackend = "do-storage" | "kv" | "r2";

/**
 * Maps a semantic storage class to its concrete Cloudflare backend.
 *
 *   hot  -> do-storage  (Durable Object transactional storage, per-session)
 *   warm -> kv           (Workers KV, shared config, read-heavy)
 *   cold -> r2           (R2 object storage, archive/large blobs)
 */
export function storageClassToBackend(sc: StorageClass): StorageBackend {
  switch (sc) {
    case "hot":
      return "do-storage";
    case "warm":
      return "kv";
    case "cold":
      return "r2";
  }
}

// ── Provisional Marker ──

/**
 * Tracks the confidence level of a storage placement decision.
 *
 *   provisional     — hypothesis only, no runtime evidence yet
 *   evidence-backed — confirmed by eval-observability StoragePlacementLog
 *   frozen          — locked by architecture decision, not subject to calibration
 */
export type ProvisionalMarker = "provisional" | "evidence-backed" | "frozen";

// ── Responsible Runtime ──

/**
 * Which runtime subsystem is the primary owner of a given data item.
 * This determines who triggers writes, archives, and promotions/demotions.
 */
export type ResponsibleRuntime =
  | "session-do"
  | "workspace"
  | "eval"
  | "capability"
  | "hooks"
  | "platform";
