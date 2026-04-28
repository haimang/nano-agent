// ZX5 Lane C C2 — single source of truth: import HMAC JWT primitives from
// `@haimang/jwt-shared`. base64Url / importKey / parseJwtHeader /
// collectVerificationKeys / resolveSigningSecret 全部在 jwt-shared,
// orchestrator-auth 只保留 worker-specific narrowing(AccessTokenClaims +
// AuthServiceError 包装)。
import {
  base64Url,
  collectVerificationKeys as sharedCollectVerificationKeys,
  importKey as sharedImportKey,
  resolveSigningSecret as sharedResolveSigningSecret,
  signJwt as sharedSignJwt,
  type JwtEnvLike,
} from "@haimang/jwt-shared";
import {
  AccessTokenClaimsSchema,
  type AccessTokenClaims,
} from "@haimang/orchestrator-auth-contract";
import { AuthServiceError } from "./errors.js";

export type JwtEnv = JwtEnvLike;

function resolveSigningSecret(env: JwtEnv): { kid: string; secret: string } {
  const result = sharedResolveSigningSecret(env);
  if (!result) {
    throw new AuthServiceError(
      "worker-misconfigured",
      503,
      typeof env.JWT_SIGNING_KID === "string" && env.JWT_SIGNING_KID.length > 0
        ? `missing JWT signing secret for kid ${env.JWT_SIGNING_KID}`
        : "JWT signing keys are not configured",
    );
  }
  return result;
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
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;
  const payload: AccessTokenClaims = {
    ...claims,
    user_uuid: claims.user_uuid ?? claims.sub,
    typ: "access",
    iat: now,
    exp,
  };
  const token = await sharedSignJwt({
    header: { alg: "HS256", typ: "JWT", kid },
    payload,
    secret,
  });
  return { token, kid, exp };
}

export async function verifyAccessToken(token: string, env: JwtEnv): Promise<AccessTokenClaims> {
  // ZX5 Lane C C2 — keep verifyAccessToken's worker-specific narrowing
  // (AuthServiceError on invalid + AccessTokenClaims normalization),
  // but delegate signature/keyring iteration to jwt-shared primitives.
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthServiceError("invalid-auth", 401, "token missing, invalid, or expired");
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new AuthServiceError("invalid-auth", 401, "token missing, invalid, or expired");
  }

  const keys = sharedCollectVerificationKeys(env);
  if (keys.size === 0) {
    throw new AuthServiceError("invalid-auth", 401, "token missing, invalid, or expired");
  }

  // Replicate header.kid first + fall through behavior(等价于 verifyJwtAgainstKeyring,
  // 但本路径需要在 signature 验证后做 AccessTokenClaims normalize,所以保留迭代)。
  const headerJsonRaw = (() => {
    try {
      return new TextDecoder().decode(base64Url.decode(headerB64));
    } catch {
      return null;
    }
  })();
  const header = headerJsonRaw ? (JSON.parse(headerJsonRaw) as { kid?: string }) : null;

  const orderedSecrets: Array<[string, string]> =
    header?.kid && keys.has(header.kid)
      ? [
          [header.kid, keys.get(header.kid)!],
          ...Array.from(keys.entries()).filter(([kid]) => kid !== header.kid),
        ]
      : keys.has("legacy")
        ? [["legacy", keys.get("legacy")!]]
        : [];

  const signatureBytes = base64Url.decode(signatureB64);
  const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  for (const [, secret] of orderedSecrets) {
    const key = await sharedImportKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes.buffer.slice(
        signatureBytes.byteOffset,
        signatureBytes.byteOffset + signatureBytes.byteLength,
      ) as ArrayBuffer,
      dataBytes.buffer.slice(
        dataBytes.byteOffset,
        dataBytes.byteOffset + dataBytes.byteLength,
      ) as ArrayBuffer,
    );
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
