import { describe, expect, it } from "vitest";
import {
  AuthRpcMetadataSchema,
  CreateApiKeyEnvelopeSchema,
  RegisterInputSchema,
  WeChatLoginInputSchema,
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
          team_name: "WeChat Team",
          team_slug: "wechat-team-abc123",
          membership_level: 100,
          plan_level: 0,
        },
        snapshot: {
          sub: "22222222-2222-4222-8222-222222222222",
          user_uuid: "22222222-2222-4222-8222-222222222222",
          team_uuid: "33333333-3333-4333-8333-333333333333",
          tenant_uuid: "33333333-3333-4333-8333-333333333333",
          device_uuid: "44444444-4444-4444-8444-444444444444",
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

  it("accepts WeChat decrypt payload pairs and rejects half-pairs", () => {
    const parsed = WeChatLoginInputSchema.parse({
      code: "wechat-code",
      encrypted_data: "ZW5jcnlwdGVk",
      iv: "aXY=",
      display_name: "Mini User",
    });

    expect(parsed.code).toBe("wechat-code");
    expect(parsed.iv).toBe("aXY=");

    expect(() =>
      WeChatLoginInputSchema.parse({
        code: "wechat-code",
        encrypted_data: "ZW5jcnlwdGVk",
      }),
    ).toThrow(/encrypted_data and iv must be provided together/);
  });

  it("accepts a verify-api-key success envelope", () => {
    const parsed = VerifyApiKeyEnvelopeSchema.parse({
      ok: true,
      data: {
        supported: true,
        key_id: "nak_55555555-5555-4555-8555-555555555555",
        team_uuid: "33333333-3333-4333-8333-333333333333",
        user_uuid: "22222222-2222-4222-8222-222222222222",
        membership_level: 100,
        source_name: "orchestrator.auth.api-key",
      },
    });

    expect(parsed.ok).toBe(true);
  });

  it("accepts an internal create-api-key envelope", () => {
    const parsed = CreateApiKeyEnvelopeSchema.parse({
      ok: true,
      data: {
        key_id: "nak_55555555-5555-4555-8555-555555555555",
        api_key: "nak_55555555-5555-4555-8555-555555555555",
        team_uuid: "33333333-3333-4333-8333-333333333333",
        label: "preview-key",
      },
    });

    expect(parsed.ok).toBe(true);
  });
});
