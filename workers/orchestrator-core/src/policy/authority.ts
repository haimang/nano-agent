const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TeamConfiguredEnv {
  readonly TEAM_UUID?: string;
  readonly ENVIRONMENT?: string;
}

export function jsonPolicyError(
  status: number,
  error: string,
  message: string,
): Response {
  return Response.json({ error, message }, { status });
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
