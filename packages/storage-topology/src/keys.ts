/**
 * Storage Topology — Centralized Key Builders
 *
 * All storage keys follow a consistent naming convention:
 * - DO keys: flat namespace within a single Durable Object
 * - KV keys: tenants/{team_uuid}/config/... prefix for tenant isolation
 * - R2 keys: tenants/{team_uuid}/sessions/{session}/... for deep hierarchy
 *
 * These builders are the single source of truth for key formats.
 * Never construct storage keys by hand — always use these helpers.
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — Durable Object Storage Keys
// ═══════════════════════════════════════════════════════════════════

/**
 * Keys for Durable Object transactional storage (hot tier).
 * These are scoped to a single DO instance, so no tenant prefix is needed.
 */
export const DO_KEYS = {
  SESSION_PHASE: "session:phase",
  SESSION_MESSAGES: "session:messages",
  SESSION_TURN_COUNT: "session:turn_count",
  SESSION_SYSTEM_PROMPT: "context:system_prompt",
  SESSION_HOOKS_CONFIG: "hooks:session_config",
  NACP_SESSION_REPLAY: "nacp_session:replay",
  NACP_SESSION_STREAM_SEQS: "nacp_session:stream_seqs",
  toolInflight: (requestUuid: string) => `tool:inflight:${requestUuid}`,
  audit: (date: string) => `audit:${date}`,
  workspaceFile: (path: string) => `workspace:file:${path}`,
} as const;

// ═══════════════════════════════════════════════════════════════════
// §2 — Workers KV Keys
// ═══════════════════════════════════════════════════════════════════

/**
 * Keys for Workers KV (warm tier).
 *
 * Tenant-scoped keys are under `tenants/{team_uuid}/`. The single
 * platform-scoped exception is `featureFlags`, which uses the
 * `_platform/` prefix as the one allowed ambient-config escape hatch
 * (see `docs/action-plan/storage-topology.md` Q1 / the `_platform/`
 * defer decision). Every other KV read/write MUST stay under
 * `tenants/{team_uuid}/`.
 */
export const KV_KEYS = {
  providerConfig: (teamUuid: string) =>
    `tenants/${teamUuid}/config/providers`,
  modelRegistry: (teamUuid: string) =>
    `tenants/${teamUuid}/config/models`,
  skillManifest: (teamUuid: string) =>
    `tenants/${teamUuid}/config/skills`,
  hooksPolicy: (teamUuid: string) =>
    `tenants/${teamUuid}/config/hooks_policy`,
  /**
   * Platform-wide feature flag bag. This is the ONLY `_platform/`
   * exception in `KV_KEYS`. It is reserved for ambient feature-flag
   * config shared across tenants (e.g. compact thresholds,
   * shadow-mode rollouts). Never use `_platform/` for per-tenant state.
   */
  featureFlags: () => "_platform/config/feature_flags",
} as const;

// ═══════════════════════════════════════════════════════════════════
// §3 — R2 Object Storage Keys
// ═══════════════════════════════════════════════════════════════════

/**
 * Keys for R2 object storage (cold tier).
 * All keys are tenant-scoped with deep hierarchy for session/date partitioning.
 */
export const R2_KEYS = {
  workspaceFile: (t: string, s: string, path: string) =>
    `tenants/${t}/sessions/${s}/workspace/${path}`,
  compactArchive: (t: string, s: string, range: string) =>
    `tenants/${t}/sessions/${s}/archive/${range}.jsonl`,
  sessionTranscript: (t: string, s: string) =>
    `tenants/${t}/sessions/${s}/transcript.jsonl`,
  auditArchive: (t: string, date: string, s: string) =>
    `tenants/${t}/audit/${date}/${s}.jsonl`,
  attachment: (t: string, uuid: string) =>
    `tenants/${t}/attachments/${uuid}`,
} as const;
