import { describe, expect, it } from "vitest";
import { authenticateRequest } from "../src/auth.js";
import { signTestJwt } from "./jwt-helper.js";

describe("authenticateRequest", () => {
  it("accepts kid-scoped JWT signing keys", async () => {
    const token = await signTestJwt(
      {
        sub: "11111111-1111-4111-8111-111111111111",
        user_uuid: "11111111-1111-4111-8111-111111111111",
        team_uuid: "22222222-2222-4222-8222-222222222222",
        membership_level: 100,
        source_name: "orchestrator.auth",
      },
      "x".repeat(32),
      3600,
      { kid: "v1" },
    );
    const result = await authenticateRequest(
      new Request("https://example.com/sessions/11111111-1111-4111-8111-111111111111/start", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": "33333333-3333-4333-8333-333333333333",
        },
      }),
      {
        JWT_SIGNING_KEY_v1: "x".repeat(32),
        TEAM_UUID: "nano-agent",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user_uuid).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.value.snapshot.team_uuid).toBe("22222222-2222-4222-8222-222222222222");
    expect(result.value.snapshot.tenant_uuid).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("keeps legacy JWT_SECRET verification working", async () => {
    const token = await signTestJwt(
      {
        sub: "11111111-1111-4111-8111-111111111111",
        realm: "legacy",
      },
      "y".repeat(32),
    );
    const result = await authenticateRequest(
      new Request("https://example.com/sessions/11111111-1111-4111-8111-111111111111/start", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": "33333333-3333-4333-8333-333333333333",
        },
      }),
      {
        JWT_SECRET: "y".repeat(32),
        TEAM_UUID: "nano-agent",
      },
    );

    expect(result.ok).toBe(true);
  });

  it("rejects expired tokens", async () => {
    const token = await signTestJwt(
      {
        sub: "11111111-1111-4111-8111-111111111111",
      },
      "z".repeat(32),
      -10,
    );
    const result = await authenticateRequest(
      new Request("https://example.com/sessions/11111111-1111-4111-8111-111111111111/start", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": "33333333-3333-4333-8333-333333333333",
        },
      }),
      {
        JWT_SECRET: "z".repeat(32),
        TEAM_UUID: "nano-agent",
      },
    );

    expect(result.ok).toBe(false);
  });

  it("rejects non-legacy tokens that omit kid", async () => {
    const token = await signTestJwt(
      {
        sub: "11111111-1111-4111-8111-111111111111",
        team_uuid: "22222222-2222-4222-8222-222222222222",
      },
      "x".repeat(32),
    );
    const result = await authenticateRequest(
      new Request("https://example.com/sessions/11111111-1111-4111-8111-111111111111/start", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": "33333333-3333-4333-8333-333333333333",
        },
      }),
      {
        JWT_SIGNING_KEY_v1: "x".repeat(32),
        TEAM_UUID: "nano-agent",
      },
    );

    expect(result.ok).toBe(false);
  });
});
