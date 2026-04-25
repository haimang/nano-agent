import {
  jsonPolicyError,
  readTraceUuid,
} from "./policy/authority.js";

export interface JwtPayload {
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

export interface AuthSnapshot {
  readonly sub: string;
  readonly user_uuid?: string;
  readonly team_uuid?: string;
  readonly realm?: string;
  readonly tenant_uuid?: string;
  readonly tenant_source: "claim" | "deploy-fill";
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
  readonly snapshot: AuthSnapshot;
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

const base64Url = {
  encode(buf: ArrayBuffer | Uint8Array): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  },
  decode(str: string): Uint8Array {
    let normalized = str.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    return Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0));
  },
};

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function parseJwtHeader(token: string): { kid?: string } | null {
  const [headerB64] = token.split(".");
  if (!headerB64) return null;
  try {
    const headerJson = new TextDecoder().decode(base64Url.decode(headerB64));
    return JSON.parse(headerJson) as { kid?: string };
  } catch {
    return null;
  }
}

function collectVerificationKeys(env: AuthEnv): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("JWT_SIGNING_KEY_")) continue;
    if (typeof value !== "string" || value.length < 32) continue;
    keys.set(key.slice("JWT_SIGNING_KEY_".length), value);
  }
  if (typeof env.JWT_SECRET === "string" && env.JWT_SECRET.length >= 32) {
    keys.set("legacy", env.JWT_SECRET);
  }
  return keys;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    const key = await importKey(secret);
    const signature = base64Url.decode(signatureB64);
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const valid = await crypto.subtle.verify("HMAC", key, signature, data);
    if (!valid) return null;

    const payloadJson = new TextDecoder().decode(base64Url.decode(payloadB64));
    const payload = JSON.parse(payloadJson) as JwtPayload;
    if (!payload || typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function verifyJwtAgainstKeyring(
  token: string,
  keyring: Map<string, string>,
): Promise<JwtPayload | null> {
  const header = parseJwtHeader(token);
  const orderedSecrets =
    header?.kid && keyring.has(header.kid)
      ? [keyring.get(header.kid)!, ...Array.from(keyring.entries()).filter(([kid]) => kid !== header.kid).map(([, secret]) => secret)]
      : Array.from(keyring.values());
  for (const secret of orderedSecrets) {
    const payload = await verifyJwt(token, secret);
    if (payload) return payload;
  }
  return null;
}

function parseBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
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

export async function authenticateRequest(request: Request, env: AuthEnv): Promise<AuthResult> {
  const token = parseBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: jsonPolicyError(401, "invalid-auth", "missing bearer token"),
    };
  }
  const keyring = collectVerificationKeys(env);
  if (keyring.size === 0) {
    return {
      ok: false,
      response: jsonPolicyError(503, "auth-misconfigured", "JWT secret missing or invalid"),
    };
  }
  const payload = await verifyJwtAgainstKeyring(token, keyring);
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
  const deployTenant = toOptionalString(env.TEAM_UUID);
  if (legacyTenantClaim && deployTenant && legacyTenantClaim !== deployTenant) {
    return {
      ok: false,
      response: jsonPolicyError(403, "tenant-mismatch", "tenant claim does not match deploy tenant"),
    };
  }

  const effectiveTenant = teamClaim ?? legacyTenantClaim ?? deployTenant;
  const userUuid = toOptionalString(payload.user_uuid) ?? payload.sub;
  const realm = toOptionalString(payload.realm);
  const sourceName = toOptionalString(payload.source_name);
  const membershipLevel = toOptionalNumber(payload.membership_level);
  const exp = toOptionalNumber(payload.exp);

  const snapshot: AuthSnapshot = {
    sub: payload.sub,
    ...(userUuid ? { user_uuid: userUuid } : {}),
    ...(effectiveTenant ? { team_uuid: effectiveTenant, tenant_uuid: effectiveTenant } : {}),
    tenant_source: effectiveTenant ? "claim" : "deploy-fill",
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
