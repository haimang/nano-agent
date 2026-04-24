export interface JwtPayload {
  readonly sub: string;
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
  readonly TEAM_UUID?: string;
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

function jsonError(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
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
    return { ok: false, response: jsonError(401, "invalid-auth", "missing bearer token") };
  }
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    return { ok: false, response: jsonError(503, "auth-misconfigured", "JWT secret missing or invalid") };
  }
  const payload = await verifyJwt(token, secret);
  if (!payload) {
    return { ok: false, response: jsonError(401, "invalid-auth", "token missing, invalid, or expired") };
  }

  const claimTenant = toOptionalString(payload.tenant_uuid);
  const deployTenant = toOptionalString(env.TEAM_UUID);
  if (claimTenant && deployTenant && claimTenant !== deployTenant) {
    return { ok: false, response: jsonError(403, "tenant-mismatch", "tenant claim does not match deploy tenant") };
  }

  const effectiveTenant = claimTenant ?? deployTenant;
  const realm = toOptionalString(payload.realm);
  const sourceName = toOptionalString(payload.source_name);
  const membershipLevel = toOptionalNumber(payload.membership_level);
  const exp = toOptionalNumber(payload.exp);

  const snapshot: AuthSnapshot = {
    sub: payload.sub,
    tenant_source: claimTenant ? "claim" : "deploy-fill",
    ...(realm ? { realm } : {}),
    ...(effectiveTenant ? { tenant_uuid: effectiveTenant } : {}),
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
      user_uuid: payload.sub,
      trace_uuid: request.headers.get("x-trace-uuid") ?? crypto.randomUUID(),
      snapshot,
      initial_context_seed,
    },
  };
}
