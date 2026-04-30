/**
 * `createLogger(workerName, opts)` — main factory.
 *
 * Surface: 4 levels (debug/info/warn/error) + `critical`. Each call
 * produces a single JSON line on stderr/stdout (consumed by Cloudflare
 * Workers Logs / `wrangler tail`) and, for level >= warn, optionally
 * routes a record to the persistence sink.
 *
 * RHX2 design v0.5 §7.2 F1 — Phase 1 boundary:
 *   - this file ships the core logger only;
 *   - `respondWithFacadeError` (F2) lands in Phase 3 (P3-01);
 *   - `recordAuditEvent` (F11) lands in Phase 5 (P5-04);
 *   - `emitObservabilityAlert` (F8) lands in Phase 5 (P5-06);
 *   - `tryEmitSystemError` (F7) lands in Phase 5 (P5-02/03).
 *
 * Each later helper sits next to this file under
 * `packages/nacp-core/src/observability/logger/` and is re-exported
 * via `index.ts`.
 */

import { getTraceContext } from "./als.js";
import { DedupeCache, buildDedupeKey } from "./dedupe.js";
import { RingBuffer } from "./ring-buffer.js";
import {
  LOG_LEVEL_PRIORITY,
  type CreateLoggerOptions,
  type Logger,
  type LogLevel,
  type LogPersistFn,
  type LogRecord,
} from "./types.js";

const SAFE_CTX_LIMIT = 8 * 1024; // 8 KiB

interface ConsoleLike {
  debug(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Test-only override slot for `console`. Production callers should
 * never use this — it lets the unit tests capture emitted lines.
 */
let consoleSink: ConsoleLike = console;
export function __setLoggerConsoleForTests(c: ConsoleLike | null): void {
  consoleSink = c ?? console;
}

function readEnvLevel(): LogLevel | undefined {
  // Cloudflare Workers exposes `process.env` under `nodejs_compat`.
  // Use globalThis to keep nacp-core free of `@types/node`.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const v = proc?.env?.NANO_LOG_LEVEL;
  if (!v) return undefined;
  if (v === "debug" || v === "info" || v === "warn" || v === "error" || v === "critical") {
    return v;
  }
  return undefined;
}

function safeSerializeCtx(ctx: Record<string, unknown> | undefined): {
  ctx?: Record<string, unknown>;
  serializeError?: true;
  truncated?: true;
} {
  if (ctx === undefined) return {};
  let json: string;
  try {
    json = JSON.stringify(ctx);
  } catch {
    return { ctx: { _raw: String(ctx) }, serializeError: true };
  }
  if (json.length > SAFE_CTX_LIMIT) {
    // We keep `ctx` as the parsed object (so JSON-line emission still
    // produces a valid payload) but flag the record. Callers may also
    // shrink ctx themselves before logging.
    return { ctx, truncated: true };
  }
  return { ctx };
}

function emitConsoleLine(record: LogRecord): void {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    // Last-resort: if even the LogRecord JSON serialization fails,
    // emit a degraded marker rather than throwing through the call site.
    line = JSON.stringify({
      ts: record.ts,
      level: record.level,
      worker: record.worker,
      msg: record.msg,
      _serialize_error: true,
    });
  }
  switch (record.level) {
    case "debug":
      consoleSink.debug(line);
      break;
    case "info":
      consoleSink.log(line);
      break;
    case "warn":
      consoleSink.warn(line);
      break;
    case "error":
      consoleSink.error(line);
      break;
    case "critical":
      consoleSink.error(`[CRITICAL] ${line}`);
      break;
  }
}

export function createLogger(workerName: string, opts: CreateLoggerOptions = {}): Logger {
  if (!workerName || typeof workerName !== "string") {
    throw new Error("createLogger: workerName must be a non-empty string");
  }
  const envLevel = readEnvLevel();
  const baseLevel: LogLevel = envLevel ?? opts.level ?? "info";
  const persist: LogPersistFn | undefined = opts.persistError;
  const ring = new RingBuffer<LogRecord>(opts.ringBufferSize ?? 200);
  const dedupe = new DedupeCache();
  const now = opts.now ?? (() => new Date().toISOString());

  function shouldFilter(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[baseLevel];
  }

  function buildRecord(
    level: LogLevel,
    msg: string,
    code: string | undefined,
    rawCtx: Record<string, unknown> | undefined,
  ): LogRecord {
    const traceCtx = getTraceContext();
    const safe = safeSerializeCtx(rawCtx);
    const record: LogRecord = {
      ts: now(),
      level,
      worker: workerName,
      msg,
    };
    if (traceCtx?.trace_uuid) record.trace_uuid = traceCtx.trace_uuid;
    if (traceCtx?.session_uuid) record.session_uuid = traceCtx.session_uuid;
    if (traceCtx?.team_uuid) record.team_uuid = traceCtx.team_uuid;
    if (code) record.code = code;
    if (safe.ctx !== undefined) record.ctx = safe.ctx;
    if (safe.serializeError) record._serialize_error = true;
    if (safe.truncated) record._truncated = true;
    return record;
  }

  function emit(
    level: LogLevel,
    msg: string,
    code: string | undefined,
    ctx: Record<string, unknown> | undefined,
  ): void {
    if (shouldFilter(level)) return;

    const record = buildRecord(level, msg, code, ctx);

    // Dedupe applies to warn/error only; critical always emits, debug/info skip dedupe (low value).
    if (level === "warn" || level === "error") {
      const key = buildDedupeKey(level, code, record.trace_uuid);
      if (!dedupe.shouldEmit(key, false)) return;
    }

    ring.push(record);
    emitConsoleLine(record);

    // Persist sinks for level >= warn. Failures must NOT propagate; mark the
    // record `rpc_log_failed` and re-emit a tagged line so post-incident audit
    // can still spot the gap (RHX2 design §6.2 risk #1).
    if ((level === "warn" || level === "error" || level === "critical") && persist) {
      try {
        const maybe = persist(record);
        if (maybe && typeof (maybe as Promise<void>).catch === "function") {
          (maybe as Promise<void>).catch(() => {
            const failed: LogRecord = { ...record, rpc_log_failed: true };
            ring.push(failed);
            emitConsoleLine(failed);
          });
        }
      } catch {
        const failed: LogRecord = { ...record, rpc_log_failed: true };
        ring.push(failed);
        emitConsoleLine(failed);
      }
    }
  }

  return {
    debug(msg, ctx) {
      emit("debug", msg, undefined, ctx);
    },
    info(msg, ctx) {
      emit("info", msg, undefined, ctx);
    },
    warn(msg, opts) {
      emit("warn", msg, opts?.code, opts?.ctx);
    },
    error(msg, opts) {
      emit("error", msg, opts.code, opts.ctx);
    },
    critical(msg, opts) {
      emit("critical", msg, opts.code, opts.ctx);
    },
    recentErrors(limit) {
      return ring.takeRecent(limit);
    },
  };
}
