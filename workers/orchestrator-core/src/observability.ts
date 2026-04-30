import { resolveErrorMeta } from "@haimang/nacp-core";
import {
  createLogger,
  type AuditPersistFn,
  type AuditRecord,
  type LogPersistFn,
  type LogRecord,
} from "@haimang/nacp-core/logger";

const ERROR_CONTEXT_LIMIT = 8 * 1024;
const AUDIT_DETAIL_LIMIT = 16 * 1024;

export interface ObservabilityDbEnv {
  readonly NANO_AGENT_DB?: D1Database;
}

function toJsonText(value: unknown, limitBytes: number): string | null {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).byteLength <= limitBytes) {
      return text;
    }
    return JSON.stringify({
      _truncated: true,
      preview: text.slice(0, limitBytes),
    });
  } catch {
    return JSON.stringify({
      _truncated: true,
      preview: String(value),
    });
  }
}

export async function persistErrorLogRecord(
  env: ObservabilityDbEnv,
  record: LogRecord,
): Promise<void> {
  const db = env.NANO_AGENT_DB;
  if (!db) return;
  const meta = resolveErrorMeta(record.code ?? "internal-error") ?? resolveErrorMeta("internal-error");
  if (!meta) return;
  await db.prepare(
    `INSERT INTO nano_error_log (
       log_uuid,
       trace_uuid,
       session_uuid,
       team_uuid,
       worker,
       source_role,
       code,
       category,
       severity,
       http_status,
       message,
       context_json,
       rpc_log_failed,
       created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(
    crypto.randomUUID(),
    record.trace_uuid ?? crypto.randomUUID(),
    record.session_uuid ?? null,
    record.team_uuid ?? null,
    record.worker,
    null,
    record.code ?? "internal-error",
    meta.category,
    record.level === "critical" ? "critical" : record.level === "error" ? "error" : "warn",
    meta.http_status,
    record.msg,
    toJsonText(record.ctx, ERROR_CONTEXT_LIMIT),
    record.rpc_log_failed ? 1 : 0,
    record.ts,
  ).run();
}

export async function persistAuditRecord(
  env: ObservabilityDbEnv,
  record: AuditRecord,
): Promise<void> {
  const db = env.NANO_AGENT_DB;
  if (!db) return;
  if (!record.team_uuid) {
    throw new Error("audit record requires team_uuid");
  }
  await db.prepare(
    `INSERT INTO nano_audit_log (
       audit_uuid,
       trace_uuid,
       session_uuid,
       team_uuid,
       user_uuid,
       device_uuid,
       worker,
       event_kind,
       ref_kind,
       ref_uuid,
       detail_json,
       outcome,
       created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
  ).bind(
    crypto.randomUUID(),
    record.trace_uuid ?? null,
    record.session_uuid ?? null,
    record.team_uuid,
    record.user_uuid ?? null,
    record.device_uuid ?? null,
    record.worker,
    record.event_kind,
    record.ref?.kind ?? null,
    record.ref?.uuid ?? null,
    toJsonText(record.detail, AUDIT_DETAIL_LIMIT),
    record.outcome,
    record.ts,
  ).run();
}

export function buildErrorLogPersist(env: ObservabilityDbEnv): LogPersistFn {
  return async (record) => {
    await persistErrorLogRecord(env, record);
  };
}

export function buildAuditPersist(env: ObservabilityDbEnv): AuditPersistFn {
  return async (record) => {
    await persistAuditRecord(env, record);
  };
}

export function createOrchestratorLogger(env: ObservabilityDbEnv) {
  return createLogger("orchestrator-core", {
    persistError: buildErrorLogPersist(env),
  });
}
