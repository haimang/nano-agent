import { describe, expect, it } from "vitest";
import { mintAccessToken, verifyAccessToken } from "../src/jwt.js";

// ZX5 Lane C C3 — kid rotation graceful overlap.
//
// Scenario: orchestrator-auth 在 t0 用 kid=v1 签 token;t1 owner 把
// JWT_SIGNING_KID 切到 v2 但保留 JWT_SIGNING_KEY_v1 在 keyring 中
// (graceful overlap window;default 5 min,per JWT_LEEWAY_SECONDS)。
// orchestrator-{core,auth} 必须仍然 accept v1 token,直到 v1 secret 被
// 从 wrangler env 中删除。
//
// 这是 ZX2 closure DeepSeek §5.6 + ZX4-ZX5 GPT review 一起明确要求的
// 集成测试 — 防止 v1 → v2 切换时 active session 全部断开。

const SECRET_V1 = "x".repeat(32);
const SECRET_V2 = "y".repeat(32);

const TEAM_UUID = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "22222222-2222-4222-8222-222222222222";

const baseClaims = {
  sub: USER_UUID,
  user_uuid: USER_UUID,
  team_uuid: TEAM_UUID,
  tenant_uuid: TEAM_UUID,
  realm: "default",
  source_name: "kid-rotation-test",
  membership_level: 0,
  role: "user",
};

describe("ZX5 C3 — JWT kid rotation graceful overlap", () => {
  it("verifies a v1-signed token under env that still holds v1 secret after v2 rotation", async () => {
    // t0: mint with v1
    const envT0 = {
      JWT_SIGNING_KID: "v1",
      JWT_SIGNING_KEY_v1: SECRET_V1,
    };
    const minted = await mintAccessToken(baseClaims, envT0);
    expect(minted.kid).toBe("v1");

    // t1: env rotated to v2 as preferred kid; v1 secret still in keyring
    // (graceful overlap window).
    const envT1 = {
      JWT_SIGNING_KID: "v2",
      JWT_SIGNING_KEY_v2: SECRET_V2,
      JWT_SIGNING_KEY_v1: SECRET_V1,
    };
    const claims = await verifyAccessToken(minted.token, envT1);
    expect(claims.sub).toBe(USER_UUID);
    expect(claims.team_uuid).toBe(TEAM_UUID);
  });

  it("verifies a v2-signed token under env with both v1 and v2 secrets", async () => {
    const envT1 = {
      JWT_SIGNING_KID: "v2",
      JWT_SIGNING_KEY_v2: SECRET_V2,
      JWT_SIGNING_KEY_v1: SECRET_V1,
    };
    const minted = await mintAccessToken(baseClaims, envT1);
    expect(minted.kid).toBe("v2");

    const claims = await verifyAccessToken(minted.token, envT1);
    expect(claims.sub).toBe(USER_UUID);
  });

  it("rejects v1-signed token after v1 secret is removed (post-overlap)", async () => {
    // t0: sign with v1
    const envT0 = {
      JWT_SIGNING_KID: "v1",
      JWT_SIGNING_KEY_v1: SECRET_V1,
    };
    const minted = await mintAccessToken(baseClaims, envT0);

    // t2: v1 secret physically removed from env; v2 only.
    const envT2 = {
      JWT_SIGNING_KID: "v2",
      JWT_SIGNING_KEY_v2: SECRET_V2,
    };
    await expect(verifyAccessToken(minted.token, envT2)).rejects.toThrow(
      /token missing, invalid, or expired/,
    );
  });

  it("falls back to legacy JWT_SECRET when token has no kid claim", async () => {
    const envLegacy = {
      JWT_SECRET: SECRET_V1,
    };
    const minted = await mintAccessToken(baseClaims, envLegacy);
    // legacy 路径下 kid 来自 collectVerificationKeys 的 'legacy' bucket。
    expect(minted.kid).toBe("legacy");

    const claims = await verifyAccessToken(minted.token, envLegacy);
    expect(claims.sub).toBe(USER_UUID);
  });

  it("does not silently fall through to wrong-kid secret when signature mismatch", async () => {
    const envT1 = {
      JWT_SIGNING_KID: "v2",
      JWT_SIGNING_KEY_v2: SECRET_V2,
      JWT_SIGNING_KEY_v1: SECRET_V1,
    };
    const minted = await mintAccessToken(baseClaims, envT1);

    // Tamper signature segment.
    const [headerB64, payloadB64] = minted.token.split(".");
    const tampered = `${headerB64}.${payloadB64}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    await expect(verifyAccessToken(tampered, envT1)).rejects.toThrow(
      /token missing, invalid, or expired/,
    );
  });
});
