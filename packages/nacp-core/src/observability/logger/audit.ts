import { getTraceContext } from "./als.js";
import type { AuditPersistFn, AuditRecord, LoggerExecutionContext } from "./types.js";

const DETAIL_LIMIT_BYTES = 16 * 1024;

function shrinkDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  try {
    const text = JSON.stringify(detail);
    if (new TextEncoder().encode(text).byteLength <= DETAIL_LIMIT_BYTES) {
      return detail;
    }
    return {
      _truncated: true,
      preview: text.slice(0, DETAIL_LIMIT_BYTES),
    };
  } catch {
    return { _truncated: true, preview: String(detail) };
  }
}

export interface RecordAuditEventInput {
  readonly worker: string;
  readonly event_kind: string;
  readonly outcome: "ok" | "denied" | "failed";
  readonly ref?: { kind: string; uuid: string };
  readonly detail?: Record<string, unknown>;
  readonly trace_uuid?: string;
  readonly session_uuid?: string;
  readonly team_uuid?: string;
  readonly user_uuid?: string;
  readonly device_uuid?: string;
  readonly now?: () => string;
}

export function buildAuditRecord(input: RecordAuditEventInput): AuditRecord {
  const ctx = getTraceContext();
  const teamUuid = input.team_uuid ?? ctx?.team_uuid;
  if (!teamUuid) {
    throw new Error("recordAuditEvent requires team_uuid");
  }
  return {
    ts: input.now?.() ?? new Date().toISOString(),
    worker: input.worker,
    trace_uuid: input.trace_uuid ?? ctx?.trace_uuid,
    session_uuid: input.session_uuid ?? ctx?.session_uuid,
    team_uuid: teamUuid,
    user_uuid: input.user_uuid ?? ctx?.user_uuid,
    device_uuid: input.device_uuid ?? ctx?.device_uuid,
    event_kind: input.event_kind,
    ref: input.ref,
    detail: shrinkDetail(input.detail),
    outcome: input.outcome,
  };
}

export function recordAuditEvent(
  input: RecordAuditEventInput,
  persist: AuditPersistFn,
  executionContext?: LoggerExecutionContext,
): Promise<void> | void {
  const record = buildAuditRecord(input);
  return persist(record, executionContext);
}
