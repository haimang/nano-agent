import { describe, expect, it } from "vitest";
import { authenticateRequest } from "../src/auth.js";
import { signTestJwt } from "./jwt-helper.js";

// ZX5 review (GLM R5) — orchestrator-core companion to orchestrator-auth's
// kid rotation test. orchestrator-core authenticates incoming public traffic
// via `verifyJwtAgainstKeyring` (a different jwt-shared entry point than
// orchestrator-auth's bespoke `verifyAccessToken`), so kid rotation must be
// covered separately at this seam too. If `verifyJwtAgainstKeyring` ever
// behaves asymmetrically with the orchestrator-auth verifier (e.g. silently
// fails through to a wrong-kid secret), no other test would catch it.

const SECRET_V1 = "x".repeat(32);
const SECRET_V2 = "y".repeat(32);

const TEAM_UUID = "22222222-2222-4222-8222-222222222222";
const USER_UUID = "11111111-1111-4111-8111-111111111111";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";

const baseClaims = {
  sub: USER_UUID,
  user_uuid: USER_UUID,
  team_uuid: TEAM_UUID,
  realm: "default",
  source_name: "kid-rotation-orchestrator-core",
  membership_level: 0,
};

function buildRequest(token: string): Request {
  return new Request(
    `https://example.com/sessions/${USER_UUID}/start`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        "x-trace-uuid": TRACE_UUID,
      },
    },
  );
}

describe("orchestrator-core auth — kid rotation graceful overlap", () => {
  it("accepts a v1-signed token while v1 secret is still in the keyring (post-v2-rotation)", async () => {
    const token = await signTestJwt(baseClaims, SECRET_V1, 3600, { kid: "v1" });
    // Env after rotation: v2 preferred, v1 still present (overlap window).
    const result = await authenticateRequest(buildRequest(token), {
      JWT_SIGNING_KID: "v2",
      JWT_SIGNING_KEY_v2: SECRET_V2,
      JWT_SIGNING_KEY_v1: SECRET_V1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user_uuid).toBe(USER_UUID);
    expect(result.value.snapshot.team_uuid).toBe(TEAM_UUID);
  });

  it("rejects a v1-signed token after the v1 secret is removed (post-overlap)", async () => {
    const token = await signTestJwt(baseClaims, SECRET_V1, 3600, { kid: "v1" });
    const result = await authenticateRequest(buildRequest(token), {
      JWT_SIGNING_KID: "v2",
      JWT_SIGNING_KEY_v2: SECRET_V2,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it("rejects a token whose signature does not match any keyring entry (tamper)", async () => {
    const minted = await signTestJwt(baseClaims, SECRET_V2, 3600, { kid: "v2" });
    const [headerB64, payloadB64] = minted.split(".");
    const tampered = `${headerB64}.${payloadB64}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const result = await authenticateRequest(buildRequest(tampered), {
      JWT_SIGNING_KID: "v2",
      JWT_SIGNING_KEY_v2: SECRET_V2,
      JWT_SIGNING_KEY_v1: SECRET_V1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });
});
