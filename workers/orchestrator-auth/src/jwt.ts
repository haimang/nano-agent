import {
  AccessTokenClaimsSchema,
  type AccessTokenClaims,
} from "@haimang/orchestrator-auth-contract";
import { AuthServiceError } from "./errors.js";

export interface JwtEnv {
  readonly JWT_SECRET?: string;
  readonly JWT_SIGNING_KID?: string;
  readonly [key: string]: unknown;
}

interface JwtHeader {
  readonly alg?: string;
  readonly typ?: string;
  readonly kid?: string;
}

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

function parseJwtHeader(token: string): JwtHeader | null {
  const [headerB64] = token.split(".");
  if (!headerB64) return null;
  try {
    const headerJson = new TextDecoder().decode(base64Url.decode(headerB64));
    return JSON.parse(headerJson) as JwtHeader;
  } catch {
    return null;
  }
}

function collectVerificationKeys(env: JwtEnv): Map<string, string> {
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

function resolveSigningSecret(env: JwtEnv): { kid: string; secret: string } {
  const verificationKeys = collectVerificationKeys(env);
  const preferredKid =
    typeof env.JWT_SIGNING_KID === "string" && env.JWT_SIGNING_KID.length > 0
      ? env.JWT_SIGNING_KID
      : null;
  if (preferredKid) {
    const preferredSecret = verificationKeys.get(preferredKid);
    if (!preferredSecret) {
      throw new AuthServiceError(
        "worker-misconfigured",
        503,
        `missing JWT signing secret for kid ${preferredKid}`,
      );
    }
    return { kid: preferredKid, secret: preferredSecret };
  }
  const [firstKid, firstSecret] = verificationKeys.entries().next().value ?? [];
  if (typeof firstKid === "string" && typeof firstSecret === "string") {
    return { kid: firstKid, secret: firstSecret };
  }
  throw new AuthServiceError("worker-misconfigured", 503, "JWT signing keys are not configured");
}

function normalizeClaims(payload: unknown): AccessTokenClaims {
  const parsed = AccessTokenClaimsSchema.safeParse(payload);
  if (parsed.success) {
    const userUuid = parsed.data.user_uuid ?? parsed.data.sub;
    const teamUuid = parsed.data.team_uuid ?? parsed.data.tenant_uuid;
    if (!teamUuid) {
      throw new AuthServiceError("invalid-auth", 401, "access token missing team truth");
    }
    return {
      ...parsed.data,
      user_uuid: userUuid,
      team_uuid: teamUuid,
    };
  }
  throw new AuthServiceError("invalid-auth", 401, "token missing, invalid, or expired");
}

export async function mintAccessToken(
  claims: Omit<AccessTokenClaims, "iat" | "exp" | "typ">,
  env: JwtEnv,
  expiresInSeconds = 3600,
): Promise<{ token: string; kid: string; exp: number }> {
  const { kid, secret } = resolveSigningSecret(env);
  const header = { alg: "HS256", typ: "JWT", kid };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;
  const payload: AccessTokenClaims = {
    ...claims,
    user_uuid: claims.user_uuid ?? claims.sub,
    typ: "access",
    iat: now,
    exp,
  };
  const headerB64 = base64Url.encode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64Url.encode(new TextEncoder().encode(JSON.stringify(payload)));
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return {
    token: `${headerB64}.${payloadB64}.${base64Url.encode(signature)}`,
    kid,
    exp,
  };
}

export async function verifyAccessToken(token: string, env: JwtEnv): Promise<AccessTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthServiceError("invalid-auth", 401, "token missing, invalid, or expired");
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new AuthServiceError("invalid-auth", 401, "token missing, invalid, or expired");
  }

  const header = parseJwtHeader(token);
  const keys = collectVerificationKeys(env);
  const orderedSecrets =
    header?.kid && keys.has(header.kid)
      ? [[header.kid, keys.get(header.kid)!], ...Array.from(keys.entries()).filter(([kid]) => kid !== header.kid)]
      : keys.has("legacy")
        ? [["legacy", keys.get("legacy")!]]
        : [];
  if (orderedSecrets.length === 0) {
    throw new AuthServiceError("invalid-auth", 401, "token missing, invalid, or expired");
  }

  const signature = base64Url.decode(signatureB64);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  for (const [, secret] of orderedSecrets) {
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, signature, data);
    if (!valid) continue;
    const payloadJson = new TextDecoder().decode(base64Url.decode(payloadB64));
    const payload = JSON.parse(payloadJson) as unknown;
    const claims = normalizeClaims(payload);
    if (typeof claims.exp === "number" && Date.now() / 1000 > claims.exp) {
      throw new AuthServiceError("invalid-auth", 401, "token missing, invalid, or expired");
    }
    return claims;
  }

  throw new AuthServiceError("invalid-auth", 401, "token missing, invalid, or expired");
}
