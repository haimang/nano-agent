/**
 * @haimang/jwt-shared — single source of truth for HMAC JWT primitives.
 *
 * Background(per ZX5 Lane C / R20):
 *   ZX2 / ZX3 阶段 `orchestrator-core/src/auth.ts` 与 `orchestrator-auth/src/jwt.ts`
 *   都各自实现了 base64Url / importKey / parseJwtHeader / collectVerificationKeys /
 *   verifyJwt / verifyJwtAgainstKeyring / signing helper,两份实现互相漂移。
 *   ZX5 Lane C 把这些 primitive 抽到本 package,两 worker 共用一份代码。
 *
 * 设计原则:
 *   - 仅提供 pure primitive(无 worker-specific 类型);worker-specific 配置
 *     (如 IngressAuthSnapshot / AccessTokenClaims)留在各 worker 内
 *   - 同时支持 verify(纯 verification 路径,orchestrator-core 用)与 sign
 *     (orchestrator-auth 用 mintAccessToken 内部组装)
 *   - kid rotation graceful overlap:`verifyJwtAgainstKeyring` 在 header.kid
 *     找不到对应 secret 时,顺序尝试 keyring 中其他 secret(legacy 优先);
 *     这是 5 分钟 overlap 期允许 v1 token 在 v2 切换后仍 verified 的核心
 *   - 与现有 worker 行为 100% 等价(本期是 refactor 不是 behavior change)
 */

export interface JwtEnvLike {
  readonly JWT_SECRET?: string;
  readonly JWT_SIGNING_KID?: string;
  readonly [key: string]: unknown;
}

export interface JwtHeader {
  readonly alg?: string;
  readonly typ?: string;
  readonly kid?: string;
}

/**
 * Verified JWT payload(post-signature + post-exp 检查)。
 * 仅含通用字段;worker-specific claim 字段留给 caller narrow。
 */
export interface VerifiedJwtPayload {
  readonly sub: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly [key: string]: unknown;
}

// ZX5 Lane C — graceful overlap window default. orchestrator-auth 切 kid 后
// 旧 kid 在 keyring 中保留至少这么久,verifyJwtAgainstKeyring 才能在 kid mismatch
// 时还能 fall through 到 legacy/其他 kid 验证通过。owner 可在 wrangler env
// 通过 `JWT_KID_ROTATION_OVERLAP_SECONDS` 自定义。
export const JWT_LEEWAY_SECONDS = 5 * 60;

export const base64Url = {
  encode(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return btoa(String.fromCharCode(...bytes))
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

export async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function parseJwtHeader(token: string): JwtHeader | null {
  const [headerB64] = token.split(".");
  if (!headerB64) return null;
  try {
    const headerJson = new TextDecoder().decode(base64Url.decode(headerB64));
    return JSON.parse(headerJson) as JwtHeader;
  } catch {
    return null;
  }
}

/**
 * Collect verification keys keyed by kid from env.
 * - `JWT_SIGNING_KEY_<kid>` (>= 32 chars) → keyring entry
 * - `JWT_SECRET` (>= 32 chars) → 'legacy' kid(向后兼容)
 *
 * 长度 >= 32 字符的下限是 ZX2 既有约定,与原 worker-local 实现等价。
 */
export function collectVerificationKeys(env: JwtEnvLike): Map<string, string> {
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

/**
 * Verify a single JWT against a single secret.
 * Returns parsed payload on success(signature OK + exp not past),else null.
 *
 * 当 caller 已确认要用某个 kid 对应的 secret 验证时使用此 helper。
 * 多 kid 场景请用 `verifyJwtAgainstKeyring`。
 */
export async function verifyJwt<T extends VerifiedJwtPayload = VerifiedJwtPayload>(
  token: string,
  secret: string,
): Promise<T | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    const key = await importKey(secret);
    const signatureBytes = base64Url.decode(signatureB64);
    const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
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
    if (!valid) return null;

    const payloadJson = new TextDecoder().decode(base64Url.decode(payloadB64));
    const payload = JSON.parse(payloadJson) as T;
    if (!payload || typeof (payload as VerifiedJwtPayload).sub !== "string" || (payload as VerifiedJwtPayload).sub.length === 0) {
      return null;
    }
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp + JWT_LEEWAY_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify a JWT by trying every key in the keyring,header.kid 优先。
 * 这是 graceful kid rotation 的核心:
 *   - 若 header.kid 存在且 keyring 中有同名 secret,先尝试该 secret
 *   - 失败/缺失则 fall through 到 keyring 其他 entry(legacy 在 fall back 集合中)
 *   - 全部失败返 null
 *
 * 行为与原 worker-local `verifyJwtAgainstKeyring` 等价(ZX5 Lane C 的 refactor
 * 不允许行为漂移)。
 */
export async function verifyJwtAgainstKeyring<T extends VerifiedJwtPayload = VerifiedJwtPayload>(
  token: string,
  keyring: Map<string, string>,
): Promise<T | null> {
  const header = parseJwtHeader(token);
  const orderedSecrets =
    header?.kid && keyring.has(header.kid)
      ? [
          keyring.get(header.kid)!,
          ...Array.from(keyring.entries())
            .filter(([kid]) => kid !== header.kid)
            .map(([, secret]) => secret),
        ]
      : keyring.has("legacy")
        ? [keyring.get("legacy")!]
        : [];
  for (const secret of orderedSecrets) {
    const payload = await verifyJwt<T>(token, secret);
    if (payload) return payload;
  }
  return null;
}

/**
 * Resolve which kid + secret to sign with(used by orchestrator-auth's
 * mintAccessToken).优先 env.JWT_SIGNING_KID;否则 keyring 第一条。
 *
 * Returns null if no signing key available(caller should throw a
 * worker-specific error,如 `worker-misconfigured`)。
 */
export function resolveSigningSecret(
  env: JwtEnvLike,
): { kid: string; secret: string } | null {
  const verificationKeys = collectVerificationKeys(env);
  const preferredKid =
    typeof env.JWT_SIGNING_KID === "string" && env.JWT_SIGNING_KID.length > 0
      ? env.JWT_SIGNING_KID
      : null;
  if (preferredKid) {
    const preferredSecret = verificationKeys.get(preferredKid);
    if (!preferredSecret) return null;
    return { kid: preferredKid, secret: preferredSecret };
  }
  const first = verificationKeys.entries().next().value;
  if (first) {
    const [firstKid, firstSecret] = first;
    if (typeof firstKid === "string" && typeof firstSecret === "string") {
      return { kid: firstKid, secret: firstSecret };
    }
  }
  return null;
}

/**
 * Sign a JWT with HS256 using the given kid + secret.
 * Caller controls header / payload shape;本 helper 仅做 base64url +
 * HMAC 签名拼装,与 orchestrator-auth `mintAccessToken` 内的 sign 步骤等价。
 */
export async function signJwt(input: {
  readonly header: JwtHeader & { alg: "HS256"; typ: "JWT" };
  readonly payload: Record<string, unknown>;
  readonly secret: string;
}): Promise<string> {
  const headerBytes = new TextEncoder().encode(JSON.stringify(input.header));
  const payloadBytes = new TextEncoder().encode(JSON.stringify(input.payload));
  const headerB64 = base64Url.encode(headerBytes);
  const payloadB64 = base64Url.encode(payloadBytes);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const key = await importKey(input.secret);
  // ArrayBufferView vs ArrayBuffer narrowing: pass underlying ArrayBuffer.
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  );
  return `${headerB64}.${payloadB64}.${base64Url.encode(signature)}`;
}
