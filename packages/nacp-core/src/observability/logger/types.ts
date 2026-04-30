/**
 * @haimang/nacp-core/logger — type contracts.
 *
 * RHX2 design v0.5 §7.2 F1 (worker-logger sub-module). Implemented as a
 * sub-path of nacp-core (not a standalone package) per Q-Obs10 owner answer
 * — keeps the long-term "3 published packages" boundary intact while still
 * giving every worker a single shared logger.
 */

import type { NacpErrorCategory } from "../../error-registry.js";

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

/**
 * Structured log record. Emitted as a single JSON line to console (also
 * captured by Cloudflare Workers Logs / `wrangler tail`) and optionally
 * persisted to D1 via the caller-supplied `LogPersistFn`.
 *
 * Field discipline (RHX2 design §7.3): callers MUST NOT put sensitive
 * values (API keys, JWTs, refresh tokens, WeChat codes, passwords) into
 * `ctx`. PII auto-redaction is out-of-scope for first-wave.
 */
export interface LogRecord {
  /** ISO 8601 timestamp. */
  ts: string;
  level: LogLevel;
  /** Source worker name (e.g. "orchestrator-core"). */
  worker: string;
  /** When ALS context is present, populated automatically. */
  trace_uuid?: string;
  session_uuid?: string;
  team_uuid?: string;
  /** Human-readable message; first arg of logger.{warn,error,...}. */
  msg: string;
  /** Stable error code (only meaningful for warn/error/critical). */
  code?: string;
  /** Mirror of NACP_ERROR_CATEGORY for auto-classification at sinks. */
  category?: NacpErrorCategory;
  /** Caller-supplied structured context. */
  ctx?: Record<string, unknown>;
  /**
   * Set to `true` by the F4 fallback path when `LogPersistFn` (single-write
   * point RPC to orchestrator-core) failed and we degraded to console-only.
   * Surfaced so post-incident audit can detect potential log loss.
   */
  rpc_log_failed?: true;
  /** Set when JSON.stringify on `ctx` failed (circular ref etc). */
  _serialize_error?: true;
  /** Set when `ctx` was truncated to fit the 8 KiB persistence cap. */
  _truncated?: true;
}

/**
 * NACP `audit.record` body shape (event_kind / ref / detail) — in worker
 * logger ergonomics. The actual NACP envelope is built by a downstream
 * `recordAuditEvent` helper added in Phase 5 (P5-04).
 */
export interface AuditRecord {
  ts: string;
  worker: string;
  trace_uuid?: string;
  session_uuid?: string;
  team_uuid?: string;
  user_uuid?: string;
  device_uuid?: string;
  /** First-wave taxonomy (RHX2 design §7.2 F11): 8 event_kinds. */
  event_kind: string;
  ref?: { kind: string; uuid: string };
  detail?: Record<string, unknown>;
  outcome: "ok" | "denied" | "failed";
}

/**
 * Cloudflare Workers `ExecutionContext` shape — declared locally so this
 * package keeps zero `@cloudflare/workers-types` dependency. Only the
 * `waitUntil` method is used by the logger (Phase 1) and the audit /
 * alerts helpers added in later phases.
 */
export interface LoggerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Persistence callback for error/critical records. Caller injects when constructing the logger. */
export type LogPersistFn = (
  record: LogRecord,
  ctx?: LoggerExecutionContext,
) => Promise<void> | void;

/** Persistence callback for audit records. */
export type AuditPersistFn = (
  record: AuditRecord,
  ctx?: LoggerExecutionContext,
) => Promise<void> | void;

/**
 * Caller-facing `Logger` interface. Audit / observability-alert helpers are
 * added in P5-04 / P5-06 (separate files); this interface only covers the
 * Phase 1 surface (4 levels + critical + recentErrors).
 */
export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, opts?: { code?: string; ctx?: Record<string, unknown> }): void;
  error(msg: string, opts: { code: string; ctx?: Record<string, unknown> }): void;
  critical(msg: string, opts: { code: string; ctx?: Record<string, unknown> }): void;
  /** Read up to `limit` most recent LogRecords from the in-memory ring buffer. */
  recentErrors(limit?: number): LogRecord[];
}

export interface CreateLoggerOptions {
  /** Default "info"; overridden by env `NANO_LOG_LEVEL` if set. */
  level?: LogLevel;
  /** Persistence sink for level >= warn. Optional — caller may omit during pure dev. */
  persistError?: LogPersistFn;
  /** Persistence sink for audit records. Set by P5-04 helpers. */
  persistAudit?: AuditPersistFn;
  /** Ring buffer capacity. Default 200. */
  ringBufferSize?: number;
  /** Custom clock (test-only). Defaults to `() => new Date().toISOString()`. */
  now?: () => string;
}

/** Trace context narrowed to the three IDs the logger auto-injects. */
export interface TraceContext {
  trace_uuid?: string;
  session_uuid?: string;
  team_uuid?: string;
}

/**
 * Hierarchy used to filter records below the configured log level.
 * Lower numeric = lower priority. `critical` always emits regardless.
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  critical: 50,
};
