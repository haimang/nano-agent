/**
 * Data Item Catalog — enumerates every known data category in nano-agent
 * and maps each to its provisional storage placement.
 *
 * The catalog is the single source of truth for "what data exists, where it
 * lives (provisionally), and who owns it". All entries start as provisional
 * hypotheses; they move to evidence-backed only after eval-observability
 * confirms the placement with real read/write/size metrics.
 *
 * Reference: docs/design/storage-topology-by-opus.md section 7.1
 */

import type { StorageClass, ProvisionalMarker, ResponsibleRuntime } from "./taxonomy.js";

// ── Data Item Class ──

export type DataItemClass =
  | "session-phase"
  | "session-messages"
  | "replay-buffer"
  | "stream-seqs"
  | "tool-inflight"
  | "hooks-config"
  | "audit-trail"
  | "system-prompt"
  | "workspace-file-small"
  | "workspace-file-large"
  | "compact-archive"
  | "session-transcript"
  | "audit-archive"
  | "attachment"
  | "provider-config"
  | "model-registry"
  | "skill-manifest"
  | "hooks-policy"
  | "feature-flags";

// ── Data Item Descriptor ──

export interface DataItemDescriptor {
  readonly itemClass: DataItemClass;
  readonly displayName: string;
  readonly storageClass: StorageClass;
  readonly provisionalMarker: ProvisionalMarker;
  readonly readFrequency: string;
  readonly writeFrequency: string;
  readonly sizeEstimate: string;
  readonly responsibleRuntime: ResponsibleRuntime;
  readonly revisitCondition: string;
}

// ── Data Item Catalog ──

/**
 * Pre-populated catalog sourced from the provisional placement table in
 * docs/design/storage-topology-by-opus.md section 7.1.
 *
 * Every entry is provisional unless marked otherwise. The revisitCondition
 * field documents what evidence would change the placement.
 */
export const DATA_ITEM_CATALOG: Record<DataItemClass, DataItemDescriptor> = {
  "session-phase": {
    itemClass: "session-phase",
    displayName: "Session phase + turn count",
    storageClass: "hot",
    provisionalMarker: "frozen",
    readFrequency: "every turn",
    writeFrequency: "every turn",
    sizeEstimate: "< 1KB",
    responsibleRuntime: "session-do",
    revisitCondition: "Frozen — session phase is inherently per-DO transactional state.",
  },
  "session-messages": {
    itemClass: "session-messages",
    displayName: "Message history (current)",
    storageClass: "hot",
    provisionalMarker: "provisional",
    readFrequency: "every LLM call",
    writeFrequency: "every turn",
    sizeEstimate: "10KB-500KB",
    responsibleRuntime: "session-do",
    revisitCondition: "Revisit if message history exceeds DO storage limits or compact-archive changes eviction strategy.",
  },
  "replay-buffer": {
    itemClass: "replay-buffer",
    displayName: "Replay buffer checkpoint",
    storageClass: "hot",
    provisionalMarker: "frozen",
    readFrequency: "on resume",
    writeFrequency: "on detach/hibernate",
    sizeEstimate: "1KB-100KB",
    responsibleRuntime: "session-do",
    revisitCondition: "Frozen — already defined by nacp-session (nacp_session:replay key).",
  },
  "stream-seqs": {
    itemClass: "stream-seqs",
    displayName: "Stream seq counters",
    storageClass: "hot",
    provisionalMarker: "frozen",
    readFrequency: "on resume",
    writeFrequency: "on detach/hibernate",
    sizeEstimate: "< 1KB",
    responsibleRuntime: "session-do",
    revisitCondition: "Frozen — already defined by nacp-session (nacp_session:stream_seqs key).",
  },
  "tool-inflight": {
    itemClass: "tool-inflight",
    displayName: "Tool call in-flight state",
    storageClass: "hot",
    provisionalMarker: "provisional",
    readFrequency: "every step",
    writeFrequency: "tool start/end",
    sizeEstimate: "< 10KB",
    responsibleRuntime: "capability",
    revisitCondition: "Revisit if tool-call volume per session significantly exceeds expectations.",
  },
  "hooks-config": {
    itemClass: "hooks-config",
    displayName: "Hook config (session-level)",
    storageClass: "hot",
    provisionalMarker: "provisional",
    readFrequency: "every hook emit",
    writeFrequency: "session start",
    sizeEstimate: "< 10KB",
    responsibleRuntime: "hooks",
    revisitCondition: "Revisit if hooks config becomes shared across sessions (would move to warm/KV).",
  },
  "audit-trail": {
    itemClass: "audit-trail",
    displayName: "Audit trail (current session)",
    storageClass: "hot",
    provisionalMarker: "provisional",
    readFrequency: "debug/replay",
    writeFrequency: "every event",
    sizeEstimate: "10KB-1MB/day",
    responsibleRuntime: "session-do",
    revisitCondition: "Revisit when eval evidence shows audit volume; periodic archive to R2 expected.",
  },
  "system-prompt": {
    itemClass: "system-prompt",
    displayName: "System prompt snapshot",
    storageClass: "hot",
    provisionalMarker: "provisional",
    readFrequency: "every LLM call",
    writeFrequency: "session start",
    sizeEstimate: "< 50KB",
    responsibleRuntime: "session-do",
    revisitCondition: "Revisit if system prompts become shared/cached across sessions.",
  },
  "workspace-file-small": {
    itemClass: "workspace-file-small",
    displayName: "Workspace file (small, <1MB)",
    storageClass: "hot",
    provisionalMarker: "provisional",
    readFrequency: "on demand",
    writeFrequency: "on demand",
    sizeEstimate: "< 1MB",
    responsibleRuntime: "workspace",
    revisitCondition: "1MB threshold is provisional — needs eval evidence for calibration. mime_type gate required before inline.",
  },
  "workspace-file-large": {
    itemClass: "workspace-file-large",
    displayName: "Workspace file (large, >1MB)",
    storageClass: "cold",
    provisionalMarker: "provisional",
    readFrequency: "on demand",
    writeFrequency: "on demand",
    sizeEstimate: "> 1MB",
    responsibleRuntime: "workspace",
    revisitCondition: "Materialization strategy depends on workspace namespace (mount-based). Threshold needs eval calibration.",
  },
  "compact-archive": {
    itemClass: "compact-archive",
    displayName: "Compact archive (old turns)",
    storageClass: "cold",
    provisionalMarker: "provisional",
    readFrequency: "on replay",
    writeFrequency: "on compact",
    sizeEstimate: "10KB-10MB",
    responsibleRuntime: "session-do",
    revisitCondition: "Revisit compact trigger thresholds after eval evidence on turn-count distributions.",
  },
  "session-transcript": {
    itemClass: "session-transcript",
    displayName: "Session transcript (export)",
    storageClass: "cold",
    provisionalMarker: "provisional",
    readFrequency: "on export",
    writeFrequency: "session end",
    sizeEstimate: "10KB-10MB",
    responsibleRuntime: "session-do",
    revisitCondition: "Revisit if transcript format or export frequency changes significantly.",
  },
  "audit-archive": {
    itemClass: "audit-archive",
    displayName: "Audit archive (old)",
    storageClass: "cold",
    provisionalMarker: "provisional",
    readFrequency: "debug/compliance",
    writeFrequency: "periodic",
    sizeEstimate: "varies",
    responsibleRuntime: "eval",
    revisitCondition: "Revisit archive rotation policy after compliance requirements are finalized.",
  },
  "attachment": {
    itemClass: "attachment",
    displayName: "Attachment (image/file)",
    storageClass: "cold",
    provisionalMarker: "provisional",
    readFrequency: "LLM call time",
    writeFrequency: "on upload",
    sizeEstimate: "varies",
    responsibleRuntime: "session-do",
    revisitCondition: "Revisit if attachment access patterns show hot-read behavior requiring caching.",
  },
  "provider-config": {
    itemClass: "provider-config",
    displayName: "Provider config",
    storageClass: "warm",
    provisionalMarker: "provisional",
    readFrequency: "every LLM call",
    writeFrequency: "management plane writes",
    sizeEstimate: "< 10KB",
    responsibleRuntime: "platform",
    revisitCondition: "Revisit if per-session provider overrides become common (would need DO-level cache).",
  },
  "model-registry": {
    itemClass: "model-registry",
    displayName: "Model registry snapshot",
    storageClass: "warm",
    provisionalMarker: "provisional",
    readFrequency: "every LLM call",
    writeFrequency: "management plane writes",
    sizeEstimate: "< 10KB",
    responsibleRuntime: "platform",
    revisitCondition: "Revisit if model registry grows beyond KV value size limits.",
  },
  "skill-manifest": {
    itemClass: "skill-manifest",
    displayName: "Skill manifest",
    storageClass: "warm",
    provisionalMarker: "provisional",
    readFrequency: "session start",
    writeFrequency: "management plane writes",
    sizeEstimate: "< 50KB",
    responsibleRuntime: "platform",
    revisitCondition: "Revisit if skill manifests become per-session dynamic (would move to hot).",
  },
  "hooks-policy": {
    itemClass: "hooks-policy",
    displayName: "Hook config (platform-policy)",
    storageClass: "warm",
    provisionalMarker: "provisional",
    readFrequency: "session start",
    writeFrequency: "management plane writes",
    sizeEstimate: "< 10KB",
    responsibleRuntime: "hooks",
    revisitCondition: "Revisit if hooks policy requires per-session overrides.",
  },
  "feature-flags": {
    itemClass: "feature-flags",
    displayName: "Feature flags",
    storageClass: "warm",
    provisionalMarker: "provisional",
    readFrequency: "every request",
    writeFrequency: "management plane writes",
    sizeEstimate: "< 1KB",
    responsibleRuntime: "platform",
    revisitCondition: "Revisit if feature flags need sub-second propagation (KV eventual consistency may be too slow).",
  },
};
