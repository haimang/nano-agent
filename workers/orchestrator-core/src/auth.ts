import {
  collectVerificationKeys as sharedCollectVerificationKeys,
  verifyJwt as sharedVerifyJwt,
  verifyJwtAgainstKeyring as sharedVerifyJwtAgainstKeyring,
  type VerifiedJwtPayload,
} from "@haimang/jwt-shared";
import type { OrchestratorAuthRpcService } from "@haimang/orchestrator-auth-contract";
import {
  jsonPolicyError,
  readTraceUuid,
} from "./policy/authority.js";

const DEVICE_GATE_TTL_MS = 30_000;
const deviceGateCache = new Map<string, { status: string; expires_at: number }>();

export interface JwtPayload extends VerifiedJwtPayload {
  readonly sub: string;
  readonly user_uuid?: string;
  readonly team_uuid?: string;
  readonly device_uuid?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly realm?: string;
  readonly tenant_uuid?: string;
  readonly source_name?: string;
  readonly membership_level?: number;
  readonly role?: string;
  readonly [key: string]: unknown;
}

export interface IngressAuthSnapshot {
  readonly sub: string;
  readonly user_uuid?: string;
  readonly team_uuid?: string;
  readonly realm?: string;
  readonly tenant_uuid?: string;
  readonly device_uuid: string;
  readonly tenant_source: "claim";
  readonly membership_level?: number;
  readonly source_name?: string;
  readonly exp?: number;
}

export interface InitialContextSeed {
  readonly realm_hints?: readonly string[];
  readonly source_name?: string;
  readonly default_layers: readonly string[];
  readonly user_memory_ref: string | null;
}

export interface AuthContext {
  readonly user_uuid: string;
  readonly trace_uuid: string;
  readonly snapshot: IngressAuthSnapshot;
  readonly initial_context_seed: InitialContextSeed;
}

export interface AuthEnv {
  readonly JWT_SECRET?: string;
  readonly JWT_SIGNING_KID?: string;
  readonly TEAM_UUID?: string;
  readonly ORCHESTRATOR_AUTH?: OrchestratorAuthRpcService;
  readonly NANO_AGENT_DB?: D1Database;
  readonly [key: string]: unknown;
}

export type AuthResult =
  | { ok: true; value: AuthContext }
  | { ok: false; response: Response };

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  return sharedVerifyJwt<JwtPayload>(token, secret);
}

function parseBearerToken(request: Request, allowQueryToken = false): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  if (!allowQueryToken) return null;
  const url = new URL(request.url);
  const qsToken = url.searchParams.get("access_token");
  return qsToken && qsToken.length > 0 ? qsToken : null;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function readDeviceStatus(
  env: AuthEnv,
  deviceUuid: string,
  userUuid: string,
  teamUuid: string,
): Promise<string | null> {
  const cached = deviceGateCache.get(deviceUuid);
  if (cached && cached.expires_at > Date.now()) {
    return cached.status;
  }
  const db = env.NANO_AGENT_DB;
  if (!db) return "active";
  const row = await db.prepare(
    `SELECT status
       FROM nano_user_devices
      WHERE device_uuid = ?1
        AND user_uuid = ?2
        AND team_uuid = ?3
      LIMIT 1`,
  ).bind(deviceUuid, userUuid, teamUuid).first<Record<string, unknown>>();
  const status = typeof row?.status === "string" ? row.status : null;
  if (status) {
    deviceGateCache.set(deviceUuid, { status, expires_at: Date.now() + DEVICE_GATE_TTL_MS });
  }
  return status;
}

async function authenticateApiKey(
  token: string,
  traceUuid: string,
  env: AuthEnv,
): Promise<AuthResult> {
  if (!env.ORCHESTRATOR_AUTH) {
    return {
      ok: false,
      response: jsonPolicyError(503, "worker-misconfigured", "ORCHESTRATOR_AUTH binding must be configured", traceUuid),
    };
  }
  const verified = await env.ORCHESTRATOR_AUTH.verifyApiKey(
    { api_key: token },
    { trace_uuid: traceUuid, caller: "orchestrator-core" },
  );
  if (!verified.ok) {
    return {
      ok: false,
      response: jsonPolicyError(
        verified.error.status,
        verified.error.code,
        verified.error.message,
        traceUuid,
      ),
    };
  }
  const snapshot: IngressAuthSnapshot = {
    sub: verified.data.user_uuid,
    user_uuid: verified.data.user_uuid,
    team_uuid: verified.data.team_uuid,
    tenant_uuid: verified.data.team_uuid,
    device_uuid: "",
    tenant_source: "claim",
    membership_level: verified.data.membership_level,
    source_name: verified.data.source_name,
  };
  const initial_context_seed: InitialContextSeed = {
    ...(verified.data.source_name ? { source_name: verified.data.source_name } : {}),
    default_layers: [],
    user_memory_ref: null,
  };
  return {
    ok: true,
    value: {
      user_uuid: verified.data.user_uuid,
      trace_uuid: traceUuid,
      snapshot,
      initial_context_seed,
    },
  };
}

export function clearDeviceGateCache(deviceUuid: string): void {
  deviceGateCache.delete(deviceUuid);
}

export async function authenticateRequest(
  request: Request,
  env: AuthEnv,
  options?: { readonly allowQueryToken?: boolean },
): Promise<AuthResult> {
  const token = parseBearerToken(request, options?.allowQueryToken === true);
  if (!token) {
    return {
      ok: false,
      response: jsonPolicyError(401, "invalid-auth", "missing bearer token"),
    };
  }
  const traceUuid = readTraceUuid(request);
  if (!traceUuid) {
    return {
      ok: false,
      response: jsonPolicyError(400, "invalid-trace", "trace_uuid must be supplied as x-trace-uuid header or trace_uuid query parameter"),
    };
  }

  if (token.startsWith("nak_")) {
    return authenticateApiKey(token, traceUuid, env);
  }

  const keyring = sharedCollectVerificationKeys(env);
  if (keyring.size === 0) {
    return {
      ok: false,
      response: jsonPolicyError(503, "auth-misconfigured", "JWT secret missing or invalid", traceUuid),
    };
  }
  const payload = await sharedVerifyJwtAgainstKeyring<JwtPayload>(token, keyring);
  if (!payload) {
    return {
      ok: false,
      response: jsonPolicyError(401, "invalid-auth", "token missing, invalid, or expired", traceUuid),
    };
  }

  const legacyTenantClaim = toOptionalString(payload.tenant_uuid);
  const teamClaim = toOptionalString(payload.team_uuid);
  const effectiveTenant = teamClaim ?? legacyTenantClaim;
  if (!effectiveTenant) {
    return {
      ok: false,
      response: jsonPolicyError(403, "missing-team-claim", "JWT must include team_uuid or tenant_uuid", traceUuid),
    };
  }
  const userUuid = toOptionalString(payload.user_uuid) ?? payload.sub;
  const deviceUuid = toOptionalString(payload.device_uuid);
  if (!deviceUuid) {
    return {
      ok: false,
      response: jsonPolicyError(401, "invalid-auth", "JWT must include device_uuid", traceUuid),
    };
  }
  const deviceStatus = await readDeviceStatus(env, deviceUuid, userUuid, effectiveTenant);
  if (deviceStatus !== "active") {
    clearDeviceGateCache(deviceUuid);
    return {
      ok: false,
      response: jsonPolicyError(401, "invalid-auth", "device has been revoked", traceUuid),
    };
  }

  const realm = toOptionalString(payload.realm);
  const sourceName = toOptionalString(payload.source_name);
  const membershipLevel = toOptionalNumber(payload.membership_level);
  const exp = toOptionalNumber(payload.exp);

  const snapshot: IngressAuthSnapshot = {
    sub: payload.sub,
    ...(userUuid ? { user_uuid: userUuid } : {}),
    team_uuid: effectiveTenant,
    tenant_uuid: effectiveTenant,
    device_uuid: deviceUuid,
    tenant_source: "claim",
    ...(realm ? { realm } : {}),
    ...(sourceName ? { source_name: sourceName } : {}),
    ...(membershipLevel !== undefined ? { membership_level: membershipLevel } : {}),
    ...(exp !== undefined ? { exp } : {}),
  };

  const initial_context_seed: InitialContextSeed = {
    ...(realm ? { realm_hints: [realm] } : {}),
    ...(sourceName ? { source_name: sourceName } : {}),
    default_layers: [],
    user_memory_ref: null,
  };

  return {
    ok: true,
    value: {
      user_uuid: userUuid,
      trace_uuid: traceUuid,
      snapshot,
      initial_context_seed,
    },
  };
}

export const validateIngressAuthority = authenticateRequest;
