/**
 * Runtime Environment Types — what bindings and configuration a Session DO expects.
 *
 * SessionRuntimeEnv describes the Cloudflare Worker environment bindings
 * that the Session DO needs at runtime. RuntimeConfig holds tunable
 * operational parameters with sensible defaults.
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 1 (P1-01 to P1-03)
 * Reference code: packages/nacp-session/src/websocket.ts (heartbeat/ack options)
 */

// ── Session Runtime Environment ──

/**
 * Typed environment bindings that a Session DO Worker expects.
 *
 * Required bindings:
 *   SESSION_DO  — Durable Object namespace for session actors
 *   R2_ARTIFACTS — R2 bucket for cold storage (archives, attachments, large files)
 *   KV_CONFIG   — KV namespace for warm config (provider config, model registry, etc.)
 *
 * Optional bindings:
 *   SKILL_WORKERS — Service binding to skill worker(s)
 *   LLM_API_KEY   — API key for LLM provider (may also come from KV)
 *   ENVIRONMENT   — Deployment environment identifier (e.g. "production", "staging")
 */
export interface SessionRuntimeEnv {
  readonly SESSION_DO: unknown;
  readonly R2_ARTIFACTS: unknown;
  readonly KV_CONFIG: unknown;
  readonly SKILL_WORKERS?: unknown;
  readonly LLM_API_KEY?: string;
  readonly ENVIRONMENT?: string;
}

// ── Runtime Config ──

/**
 * Tunable operational parameters for the Session DO runtime.
 * All timeouts are in milliseconds.
 */
export interface RuntimeConfig {
  readonly heartbeatIntervalMs: number;
  readonly ackTimeoutMs: number;
  readonly maxTurnSteps: number;
  readonly checkpointOnTurnEnd: boolean;
  readonly httpFallbackEnabled: boolean;
}

/**
 * Sensible defaults for RuntimeConfig.
 *
 *   heartbeatIntervalMs  = 30_000  (30s — matches nacp-session HeartbeatTracker default)
 *   ackTimeoutMs         = 10_000  (10s — generous for client round-trip)
 *   maxTurnSteps         = 50      (safety cap on kernel step loop)
 *   checkpointOnTurnEnd  = true    (persist state after each turn completes)
 *   httpFallbackEnabled  = true    (allow HTTP polling as WS fallback)
 */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  heartbeatIntervalMs: 30_000,
  ackTimeoutMs: 10_000,
  maxTurnSteps: 50,
  checkpointOnTurnEnd: true,
  httpFallbackEnabled: true,
};
