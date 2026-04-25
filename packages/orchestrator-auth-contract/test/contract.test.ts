import { describe, expect, it } from "vitest";
import {
  AuthRpcMetadataSchema,
  RegisterInputSchema,
  WeChatLoginEnvelopeSchema,
  VerifyApiKeyEnvelopeSchema,
} from "../src/index.js";

describe("orchestrator-auth-contract", () => {
  it("validates register input and rpc metadata", () => {
    const input = RegisterInputSchema.parse({
      email: "user@example.com",
      password: "password-123",
      display_name: "User",
    });
    const meta = AuthRpcMetadataSchema.parse({
      trace_uuid: "11111111-1111-4111-8111-111111111111",
      caller: "orchestrator-core",
    });

    expect(input.email).toBe("user@example.com");
    expect(meta.caller).toBe("orchestrator-core");
  });

  it("accepts a wechat success envelope", () => {
    const parsed = WeChatLoginEnvelopeSchema.parse({
      ok: true,
      data: {
        tokens: {
          access_token: "a",
          refresh_token: "b",
          expires_in: 3600,
          refresh_expires_in: 2_592_000,
          kid: "v1",
        },
        user: {
          user_uuid: "22222222-2222-4222-8222-222222222222",
          display_name: "WeChat User",
          identity_provider: "wechat",
          login_identifier: "openid-1",
        },
        team: {
          team_uuid: "33333333-3333-4333-8333-333333333333",
          membership_level: 100,
          plan_level: 0,
        },
        snapshot: {
          sub: "22222222-2222-4222-8222-222222222222",
          user_uuid: "22222222-2222-4222-8222-222222222222",
          team_uuid: "33333333-3333-4333-8333-333333333333",
          tenant_uuid: "33333333-3333-4333-8333-333333333333",
          tenant_source: "claim",
          membership_level: 100,
          source_name: "orchestrator.auth",
          exp: 1_700_000_000,
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.user.identity_provider).toBe("wechat");
    }
  });

  it("keeps verify-api-key reserved for a future phase", () => {
    const parsed = VerifyApiKeyEnvelopeSchema.parse({
      ok: true,
      data: {
        supported: false,
        reason: "reserved-for-future-phase",
      },
    });

    expect(parsed.ok).toBe(true);
  });
});
