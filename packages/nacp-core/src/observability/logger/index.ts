/**
 * @haimang/nacp-core/logger — Phase 1 public surface.
 *
 * Imported by every nano-agent worker as the canonical logger:
 *
 *   import { createLogger, withTraceContext } from "@haimang/nacp-core/logger";
 *   const logger = createLogger("orchestrator-core", { persistError });
 *   withTraceContext({ trace_uuid }, () => logger.error("...", { code: "..." }));
 *
 * Helpers introduced in later phases (respondWithFacadeError, recordAuditEvent,
 * emitObservabilityAlert, tryEmitSystemError) live next to this file and are
 * re-exported here so callers always import from the same path.
 */

export { createLogger, __setLoggerConsoleForTests } from "./logger.js";
export { withTraceContext, getTraceContext, traceContextStorage } from "./als.js";
export { RingBuffer } from "./ring-buffer.js";
export { DedupeCache, buildDedupeKey } from "./dedupe.js";
export {
  respondWithFacadeError,
  attachServerTimings,
  buildFacadeServerTimings,
} from "./respond.js";
export type {
  FacadeErrorBody,
  FacadeErrorEnvelopeWire,
  RespondWithFacadeErrorOptions,
  ServerTiming,
} from "./respond.js";
export type {
  LogLevel,
  LogRecord,
  AuditRecord,
  LogPersistFn,
  AuditPersistFn,
  Logger,
  CreateLoggerOptions,
  TraceContext,
} from "./types.js";
export { LOG_LEVEL_PRIORITY } from "./types.js";
