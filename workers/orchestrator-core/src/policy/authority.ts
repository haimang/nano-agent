import {
  facadeError,
  type FacadeErrorCode,
} from "@haimang/orchestrator-auth-contract";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TeamConfiguredEnv {
  readonly TEAM_UUID?: string;
  readonly ENVIRONMENT?: string;
}

// ZX2 Phase 4 P4-01 — `jsonPolicyError` now emits a `facade-http-v1`
// envelope (`{ ok:false, error:{code,status,message}, trace_uuid }`).
// Legacy callers that pass an unknown code get coerced to
// `internal-error` (matching nacp-core's RpcErrorCode union).
//
// The `error` argument keeps the historical free-form string for source
// compat; new call sites should pass a `FacadeErrorCode` value directly.
export function jsonPolicyError(
  status: number,
  error: string,
  message: string,
  trace_uuid?: string,
): Response {
  const tracedUuid = trace_uuid ?? crypto.randomUUID();
  // Best-effort coerce string → FacadeErrorCode. The contract package
  // owns the canonical taxonomy; any unrecognised string becomes
  // `internal-error` so the wire shape never carries garbage codes.
  const envelope = facadeError(
    error as FacadeErrorCode,
    status,
    message,
    tracedUuid,
  );
  return Response.json(envelope, {
    status,
    headers: { "x-trace-uuid": tracedUuid },
  });
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function readTraceUuid(request: Request): string | null {
  const headerTrace = request.headers.get("x-trace-uuid");
  if (isUuid(headerTrace)) return headerTrace;
  const queryTrace = new URL(request.url).searchParams.get("trace_uuid");
  return isUuid(queryTrace) ? queryTrace : null;
}

export function ensureConfiguredTeam(env: TeamConfiguredEnv): Response | null {
  if (!env.TEAM_UUID && env.ENVIRONMENT !== "test") {
    return jsonPolicyError(503, "worker-misconfigured", "TEAM_UUID must be configured");
  }
  return null;
}
