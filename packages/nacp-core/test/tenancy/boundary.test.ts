import { describe, it, expect } from "vitest";
import { verifyTenantBoundary, type TenantBoundaryContext } from "../../src/tenancy/boundary.js";
import { NacpValidationError } from "../../src/errors.js";
import type { NacpEnvelope } from "../../src/envelope.js";

const TEAM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_SENT_AT = "2026-04-16T00:00:00.000+00:00";
const VALID_PRODUCER_ID = "nano-agent.session.do@v1";

function makeEnvelope(overrides: Record<string, unknown> = {}): NacpEnvelope {
  return {
    header: {
      schema_version: "1.0.0",
      message_uuid: "11111111-1111-1111-1111-111111111111",
      message_type: "tool.call.request",
      delivery_kind: "command",
      sent_at: VALID_SENT_AT,
      producer_role: "session",
      producer_key: VALID_PRODUCER_ID,
      priority: "normal",
    },
    authority: {
      team_uuid: TEAM_A,
      plan_level: "pro",
      stamped_by_key: "nano-agent.platform.ingress@v1",
      stamped_at: VALID_SENT_AT,
    },
    trace: {
      trace_uuid: "11111111-1111-1111-1111-111111111111",
      session_uuid: "22222222-2222-2222-2222-222222222222",
    },
    ...overrides,
  } as NacpEnvelope;
}

function ctx(team: string, opts: Partial<TenantBoundaryContext> = {}): TenantBoundaryContext {
  return { serving_team_uuid: team, accept_delegation: false, ...opts };
}

async function expectBoundaryRejects(
  env: NacpEnvelope,
  boundaryCtx: TenantBoundaryContext,
  expectedCode: string,
): Promise<void> {
  try {
    await verifyTenantBoundary(env, boundaryCtx);
    expect.fail(`should have thrown ${expectedCode}`);
  } catch (e) {
    expect(e).toBeInstanceOf(NacpValidationError);
    expect((e as NacpValidationError).code).toBe(expectedCode);
  }
}

describe("verifyTenantBoundary — attack scenarios", () => {
  it("ATTACK 2: serving team B receives authority team A → NACP_TENANT_MISMATCH", async () => {
    await expectBoundaryRejects(makeEnvelope(), ctx(TEAM_B), "NACP_TENANT_MISMATCH");
  });

  it("ATTACK 3: refs team_uuid = B, authority = A → NACP_TENANT_BOUNDARY_VIOLATION", async () => {
    await expectBoundaryRejects(
      makeEnvelope({ refs: [{ kind: "r2", binding: "R2", team_uuid: TEAM_B, key: `tenants/${TEAM_B}/f.json`, role: "input" }] }),
      ctx(TEAM_A),
      "NACP_TENANT_BOUNDARY_VIOLATION",
    );
  });

  it("ATTACK 4: refs key has wrong tenant prefix → NACP_TENANT_BOUNDARY_VIOLATION", async () => {
    await expectBoundaryRejects(
      makeEnvelope({ refs: [{ kind: "r2", binding: "R2", team_uuid: TEAM_A, key: `tenants/${TEAM_B}/f.json`, role: "input" }] }),
      ctx(TEAM_A),
      "NACP_TENANT_BOUNDARY_VIOLATION",
    );
  });

  it("ATTACK 5: refs key missing tenants/ prefix → NACP_TENANT_BOUNDARY_VIOLATION", async () => {
    await expectBoundaryRejects(
      makeEnvelope({ refs: [{ kind: "r2", binding: "R2", team_uuid: TEAM_A, key: "sessions/f.json", role: "input" }] }),
      ctx(TEAM_A),
      "NACP_TENANT_BOUNDARY_VIOLATION",
    );
  });

  it("ATTACK 6: DO team = A, envelope team = B → NACP_TENANT_MISMATCH", async () => {
    const env = makeEnvelope({ authority: { team_uuid: TEAM_B, plan_level: "pro", stamped_by_key: "nano-agent.platform.ingress@v1", stamped_at: VALID_SENT_AT } });
    await expectBoundaryRejects(env, ctx("any", { do_team_uuid: TEAM_A }), "NACP_TENANT_MISMATCH");
  });

  it("ATTACK 7: _platform with non-platform role → NACP_TENANT_BOUNDARY_VIOLATION", async () => {
    const env = makeEnvelope({ authority: { team_uuid: "_platform", plan_level: "internal", stamped_by_key: "nano-agent.platform.ingress@v1", stamped_at: VALID_SENT_AT } });
    await expectBoundaryRejects(env, ctx("any"), "NACP_TENANT_BOUNDARY_VIOLATION");
  });

  it("ATTACK 8: cross-tenant without delegation → NACP_TENANT_MISMATCH", async () => {
    await expectBoundaryRejects(makeEnvelope(), ctx(TEAM_B), "NACP_TENANT_MISMATCH");
  });

  it("ATTACK 9: delegation without secret → NACP_DELEGATION_INVALID", async () => {
    const env = makeEnvelope({
      control: {
        tenant_delegation: {
          delegated_team_uuid: TEAM_A, delegator_role: "platform", scope: ["read"],
          delegation_uuid: "11111111-1111-1111-1111-111111111111",
          delegation_issued_at: VALID_SENT_AT, delegation_expires_at: "2030-01-01T00:00:00.000+00:00",
          delegation_reason: "maintenance", signature: "fakesig",
        },
      },
    });
    await expectBoundaryRejects(env, ctx(TEAM_B, { accept_delegation: true }), "NACP_DELEGATION_INVALID");
  });

  it("ATTACK 10: delegation with bad signature → NACP_DELEGATION_INVALID", async () => {
    const env = makeEnvelope({
      control: {
        tenant_delegation: {
          delegated_team_uuid: TEAM_A, delegator_role: "platform", scope: ["read"],
          delegation_uuid: "11111111-1111-1111-1111-111111111111",
          delegation_issued_at: VALID_SENT_AT, delegation_expires_at: "2030-01-01T00:00:00.000+00:00",
          delegation_reason: "maintenance", signature: "bad-sig",
        },
      },
    });
    await expectBoundaryRejects(
      env,
      ctx(TEAM_B, { accept_delegation: true, delegation_secret: "test-secret" }),
      "NACP_DELEGATION_INVALID",
    );
  });
});

describe("verifyTenantBoundary — happy paths", () => {
  it("passes when serving team matches", async () => {
    await expect(verifyTenantBoundary(makeEnvelope(), ctx(TEAM_A))).resolves.toBeUndefined();
  });

  it("passes when serving_team_uuid = 'any'", async () => {
    await expect(verifyTenantBoundary(makeEnvelope(), ctx("any"))).resolves.toBeUndefined();
  });

  it("passes when _platform used by platform role", async () => {
    const env = makeEnvelope({
      header: { schema_version: "1.0.0", message_uuid: "11111111-1111-1111-1111-111111111111", message_type: "tool.call.request", delivery_kind: "command", sent_at: VALID_SENT_AT, producer_role: "platform", producer_key: "nano-agent.platform.cron@v1", priority: "normal" },
      authority: { team_uuid: "_platform", plan_level: "internal", stamped_by_key: "nano-agent.platform.ingress@v1", stamped_at: VALID_SENT_AT },
    });
    await expect(verifyTenantBoundary(env, ctx("any"))).resolves.toBeUndefined();
  });

  it("passes with refs when team_uuid matches", async () => {
    const env = makeEnvelope({ refs: [{ kind: "r2", binding: "R2", team_uuid: TEAM_A, key: `tenants/${TEAM_A}/f.json`, role: "input" }] });
    await expect(verifyTenantBoundary(env, ctx(TEAM_A))).resolves.toBeUndefined();
  });
});
