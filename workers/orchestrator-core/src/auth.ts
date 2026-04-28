// ZX5 Lane C C2 — single source of truth: import HMAC JWT primitives from
// `@haimang/jwt-shared`. Pre-ZX5 这些 helper(base64Url / importKey /
// parseJwtHeader / collectVerificationKeys / verifyJwt /
// verifyJwtAgainstKeyring)在 worker 内部本地实现一份;ZX5 抽到 jwt-shared
// 后两个 worker 共用一份代码,行为 100% 等价。
import {
  collectVerificationKeys as sharedCollectVerificationKeys,
  verifyJwtAgainstKeyring as sharedVerifyJwtAgainstKeyring,
  type VerifiedJwtPayload,
} from "@haimang/jwt-shared";
import {
  jsonPolicyError,
  readTraceUuid,
} from "./policy/authority.js";

export interface JwtPayload extends VerifiedJwtPayload {
  readonly sub: string;
  readonly user_uuid?: string;
  readonly team_uuid?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly realm?: string;
  readonly tenant_uuid?: string;
  readonly source_name?: string;
  readonly membership_level?: number;
  readonly role?: string;
  readonly [key: string]: unknown;
}

/**
 * Ingress-only auth shape. The contract package's `AuthSnapshot`
 * stays strict and claim-backed; this local form keeps the same
 * claim-backed tenant contract for public session ingress.
 */
export interface IngressAuthSnapshot {
  readonly sub: string;
  readonly user_uuid?: string;
  readonly team_uuid?: string;
  readonly realm?: string;
  readonly tenant_uuid?: string;
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
  readonly [key: string]: unknown;
}

export type AuthResult =
  | { ok: true; value: AuthContext }
  | { ok: false; response: Response };

// ZX5 Lane C C2 — verifyJwt re-export that narrows JwtShared payload to
// orchestrator-core's local `JwtPayload` shape(向后兼容外部 import)。
// jwt-shared.verifyJwt 接受同样的 generic,这里只是给一个 narrower 名字。
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const { verifyJwt: sharedVerifyJwt } = await import("@haimang/jwt-shared");
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
  const keyring = sharedCollectVerificationKeys(env);
  if (keyring.size === 0) {
    return {
      ok: false,
      response: jsonPolicyError(503, "auth-misconfigured", "JWT secret missing or invalid"),
    };
  }
  const payload = await sharedVerifyJwtAgainstKeyring<JwtPayload>(token, keyring);
  if (!payload) {
    return {
      ok: false,
      response: jsonPolicyError(401, "invalid-auth", "token missing, invalid, or expired"),
    };
  }
  const traceUuid = readTraceUuid(request);
  if (!traceUuid) {
    return {
      ok: false,
      response: jsonPolicyError(400, "invalid-trace", "trace_uuid must be supplied as x-trace-uuid header or trace_uuid query parameter"),
    };
  }

  const legacyTenantClaim = toOptionalString(payload.tenant_uuid);
  const teamClaim = toOptionalString(payload.team_uuid);
  const effectiveTenant = teamClaim ?? legacyTenantClaim;
  if (!effectiveTenant) {
    return {
      ok: false,
      response: jsonPolicyError(403, "missing-team-claim", "JWT must include team_uuid or tenant_uuid"),
    };
  }
  const userUuid = toOptionalString(payload.user_uuid) ?? payload.sub;
  const realm = toOptionalString(payload.realm);
  const sourceName = toOptionalString(payload.source_name);
  const membershipLevel = toOptionalNumber(payload.membership_level);
  const exp = toOptionalNumber(payload.exp);

  const snapshot: IngressAuthSnapshot = {
    sub: payload.sub,
    ...(userUuid ? { user_uuid: userUuid } : {}),
    team_uuid: effectiveTenant,
    tenant_uuid: effectiveTenant,
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
