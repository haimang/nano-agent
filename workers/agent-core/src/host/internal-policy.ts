const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface InternalAuthorityEnv {
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
  readonly TEAM_UUID?: string;
  readonly ENVIRONMENT?: string;
}

export interface InternalAuthorityPayload {
  readonly sub: string;
  readonly tenant_uuid?: string;
  readonly tenant_source?: "claim" | "deploy-fill";
  readonly membership_level?: number;
  readonly source_name?: string;
  readonly exp?: number;
}

export type InternalAuthorityResult =
  | {
      ok: true;
      traceUuid: string;
      authority: InternalAuthorityPayload;
      bodyText?: string;
      bodyJson: Record<string, unknown> | null;
    }
  | {
      ok: false;
      response: Response;
    };

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAuthority(
  value: unknown,
  teamUuid: string | null,
): InternalAuthorityPayload | null {
  if (!isRecord(value)) return null;
  if (typeof value.sub !== "string" || value.sub.length === 0) return null;
  if (
    value.tenant_source !== undefined &&
    value.tenant_source !== "claim" &&
    value.tenant_source !== "deploy-fill"
  ) {
    return null;
  }
  if (
    value.membership_level !== undefined &&
    (typeof value.membership_level !== "number" || !Number.isFinite(value.membership_level))
  ) {
    return null;
  }
  if (
    value.exp !== undefined &&
    (typeof value.exp !== "number" || !Number.isFinite(value.exp))
  ) {
    return null;
  }

  const tenantUuid =
    typeof value.tenant_uuid === "string" && value.tenant_uuid.length > 0
      ? value.tenant_uuid
      : teamUuid;
  if (teamUuid && tenantUuid && tenantUuid !== teamUuid) {
    return null;
  }

  return {
    sub: value.sub,
    ...(tenantUuid ? { tenant_uuid: tenantUuid } : {}),
    ...(value.tenant_source ? { tenant_source: value.tenant_source } : {}),
    ...(value.membership_level !== undefined
      ? { membership_level: value.membership_level }
      : {}),
    ...(typeof value.source_name === "string" && value.source_name.length > 0
      ? { source_name: value.source_name }
      : {}),
    ...(value.exp !== undefined ? { exp: value.exp } : {}),
  };
}

function authorityEquals(
  left: InternalAuthorityPayload,
  right: InternalAuthorityPayload,
): boolean {
  return (
    left.sub === right.sub &&
    (left.tenant_uuid ?? null) === (right.tenant_uuid ?? null) &&
    (left.tenant_source ?? null) === (right.tenant_source ?? null) &&
    (left.membership_level ?? null) === (right.membership_level ?? null) &&
    (left.source_name ?? null) === (right.source_name ?? null) &&
    (left.exp ?? null) === (right.exp ?? null)
  );
}

export async function validateInternalAuthority(
  request: Request,
  env: InternalAuthorityEnv,
): Promise<InternalAuthorityResult> {
  const expectedSecret = env.NANO_INTERNAL_BINDING_SECRET;
  const providedSecret = request.headers.get("x-nano-internal-binding-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return {
      ok: false,
      response: jsonResponse(401, {
        error: "invalid-internal-auth",
        message: "internal binding secret missing or invalid",
      }),
    };
  }

  const teamUuid =
    typeof env.TEAM_UUID === "string" && env.TEAM_UUID.length > 0
      ? env.TEAM_UUID
      : null;
  if (!teamUuid && env.ENVIRONMENT !== "test") {
    return {
      ok: false,
      response: jsonResponse(503, {
        error: "worker-misconfigured",
        message: "TEAM_UUID must be configured",
      }),
    };
  }

  const traceUuid = request.headers.get("x-trace-uuid");
  if (!isUuid(traceUuid)) {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: "invalid-trace",
        message: "x-trace-uuid must be a UUID",
      }),
    };
  }

  const authorityHeader = request.headers.get("x-nano-internal-authority");
  if (!authorityHeader) {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: "missing-authority",
        message: "x-nano-internal-authority is required",
      }),
    };
  }

  let headerAuthorityRaw: unknown;
  try {
    headerAuthorityRaw = JSON.parse(authorityHeader);
  } catch {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: "invalid-authority",
        message: "x-nano-internal-authority must be valid JSON",
      }),
    };
  }

  const authority = normalizeAuthority(headerAuthorityRaw, teamUuid);
  if (!authority) {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: "invalid-authority",
        message: "internal authority payload is invalid or violates tenant truth",
      }),
    };
  }

  const bodyText =
    request.method.toUpperCase() === "GET" || request.method.toUpperCase() === "HEAD"
      ? undefined
      : await request.text();
  if (!bodyText) {
    return { ok: true, traceUuid, authority, bodyText, bodyJson: null };
  }

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: "invalid-internal-body",
        message: "internal actions expect a JSON body",
      }),
    };
  }
  if (!isRecord(bodyJson)) {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: "invalid-internal-body",
        message: "internal body must be a JSON object",
      }),
    };
  }

  if (bodyJson.trace_uuid !== undefined && bodyJson.trace_uuid !== traceUuid) {
    return {
      ok: false,
      response: jsonResponse(403, {
        error: "authority-escalation",
        message: "body trace_uuid must match x-trace-uuid",
      }),
    };
  }

  const bodyAuthority = normalizeAuthority(
    bodyJson.authority ?? bodyJson.auth_snapshot,
    teamUuid,
  );
  if ((bodyJson.authority !== undefined || bodyJson.auth_snapshot !== undefined) && !bodyAuthority) {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: "invalid-authority",
        message: "body authority payload is invalid or violates tenant truth",
      }),
    };
  }
  if (bodyAuthority && !authorityEquals(authority, bodyAuthority)) {
    return {
      ok: false,
      response: jsonResponse(403, {
        error: "authority-escalation",
        message: "body authority must not diverge from internal authority header",
      }),
    };
  }

  return {
    ok: true,
    traceUuid,
    authority,
    bodyText,
    bodyJson,
  };
}
