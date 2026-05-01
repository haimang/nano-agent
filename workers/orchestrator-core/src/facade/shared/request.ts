import { ensureConfiguredTeam, jsonPolicyError } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SESSION_FILE_BYTES = 25 * 1024 * 1024;
const MIME_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

export const RESTORE_REQUEST_MODES = ["conversation_only", "files_only", "conversation_and_files"] as const;
export type RestoreRequestMode = (typeof RESTORE_REQUEST_MODES)[number];

export function ensureTenantConfigured(env: OrchestratorCoreEnv): Response | null {
  return ensureConfiguredTeam(env);
}

export function clampLimit(raw: string | null, fallback: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

export async function parseBody(request: Request, optional = false): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length === 0) return optional ? {} : null;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return optional ? {} : null;
  }
}

export function parseListLimit(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > max) {
    return fallback;
  }
  return value;
}

export function encodeConversationCursor(startedAt: string, conversationUuid: string): string {
  return `${startedAt}|${conversationUuid}`;
}

export function encodeSessionCursor(startedAt: string, sessionUuid: string): string {
  return `${startedAt}|${sessionUuid}`;
}

export function parseSessionCursor(raw: string | null): { started_at: string; session_uuid: string } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const [startedAt, sessionUuid] = raw.split("|");
  if (!startedAt || !sessionUuid || !UUID_RE.test(sessionUuid)) return null;
  return { started_at: startedAt, session_uuid: sessionUuid };
}

export function parseConversationCursor(raw: string | null): { started_at: string; conversation_uuid: string } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const [startedAt, conversationUuid] = raw.split("|");
  if (!startedAt || !conversationUuid || !UUID_RE.test(conversationUuid)) return null;
  return { started_at: startedAt, conversation_uuid: conversationUuid };
}

export async function parseSessionFileUpload(
  request: Request,
  traceUuid: string,
): Promise<
  | { bytes: ArrayBuffer; mime: string | null; original_name: string | null }
  | { response: Response }
> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return {
      response: jsonPolicyError(400, "invalid-input", "files upload requires multipart/form-data", traceUuid),
    };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return {
      response: jsonPolicyError(400, "invalid-input", "multipart body could not be parsed", traceUuid),
    };
  }
  const entry = form.get("file");
  if (!isUploadBlob(entry)) {
    return {
      response: jsonPolicyError(400, "invalid-input", "multipart field 'file' is required", traceUuid),
    };
  }
  if (entry.size > MAX_SESSION_FILE_BYTES) {
    return {
      response: jsonPolicyError(413, "payload-too-large", "file exceeds 25 MiB limit", traceUuid),
    };
  }
  const explicitMime = form.get("mime");
  const mimeCandidate =
    typeof explicitMime === "string" && explicitMime.trim().length > 0
      ? explicitMime.trim()
      : typeof entry.type === "string" && entry.type.trim().length > 0
        ? entry.type.trim()
        : null;
  const mime = normalizeMime(mimeCandidate);
  if (mimeCandidate !== null && mime === null) {
    return {
      response: jsonPolicyError(400, "invalid-input", "mime must be a valid type/subtype", traceUuid),
    };
  }
  const bytes = await entry.arrayBuffer();
  if (bytes.byteLength > MAX_SESSION_FILE_BYTES) {
    return {
      response: jsonPolicyError(413, "payload-too-large", "file exceeds 25 MiB limit", traceUuid),
    };
  }
  const originalName =
    typeof entry.name === "string" && entry.name.trim().length > 0
      ? entry.name.trim().slice(0, 255)
      : null;
  return {
    bytes,
    mime,
    original_name: originalName,
  };
}

function isUploadBlob(value: unknown): value is File {
  return typeof value === "object"
    && value !== null
    && typeof (value as Blob).arrayBuffer === "function"
    && typeof (value as Blob).size === "number";
}

function normalizeMime(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 255) return null;
  return MIME_RE.test(trimmed) ? trimmed : null;
}

export function sanitizeContentDispositionFilename(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
}
