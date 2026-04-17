import { describe, it, expect } from "vitest";
import {
  createDelegationSignature,
  verifyDelegationSignature,
} from "../../src/tenancy/delegation.js";
import { NacpValidationError } from "../../src/errors.js";
import type { NacpTenantDelegation } from "../../src/envelope.js";

const SECRET = "test-secret-for-hmac";
const TEAM_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DELEGATION_UUID = "11111111-1111-1111-1111-111111111111";
const NOW_ISO = new Date().toISOString();
const FUTURE_ISO = "2030-01-01T00:00:00.000+00:00";
const PAST_ISO = "2020-01-01T00:00:00.000+00:00";

async function makeSigned(
  overrides: Partial<NacpTenantDelegation> = {},
): Promise<NacpTenantDelegation> {
  const base = {
    delegated_team_uuid: TEAM_UUID,
    delegator_role: "platform" as const,
    scope: ["read" as const],
    delegation_uuid: DELEGATION_UUID,
    delegation_issued_at: NOW_ISO,
    delegation_expires_at: FUTURE_ISO,
    delegation_reason: "test delegation",
    ...overrides,
  };
  const sig = await createDelegationSignature(base, SECRET);
  return { ...base, signature: sig };
}

describe("delegation signature", () => {
  it("verifies a correctly signed delegation", async () => {
    const d = await makeSigned();
    await expect(verifyDelegationSignature(d, SECRET)).resolves.toBeUndefined();
  });

  it("rejects expired delegation", async () => {
    const d = await makeSigned({ delegation_expires_at: PAST_ISO });
    try {
      await verifyDelegationSignature(d, SECRET);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(NacpValidationError);
      expect((e as NacpValidationError).code).toBe("NACP_DELEGATION_INVALID");
      expect((e as NacpValidationError).errors[0]).toContain("expired");
    }
  });

  it("rejects forged signature", async () => {
    const d = await makeSigned();
    d.signature = "0000000000000000000000000000000000000000000000000000000000000000";
    try {
      await verifyDelegationSignature(d, SECRET);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(NacpValidationError);
      expect((e as NacpValidationError).code).toBe("NACP_DELEGATION_INVALID");
      expect((e as NacpValidationError).errors[0]).toContain("mismatch");
    }
  });

  it("rejects delegation signed with wrong secret", async () => {
    const d = await makeSigned();
    try {
      await verifyDelegationSignature(d, "wrong-secret");
      expect.fail("should throw");
    } catch (e) {
      expect((e as NacpValidationError).code).toBe("NACP_DELEGATION_INVALID");
    }
  });

  it("produces different signatures for different payloads", async () => {
    const sig1 = await createDelegationSignature(
      {
        delegated_team_uuid: TEAM_UUID,
        delegator_role: "platform",
        scope: ["read"],
        delegation_uuid: DELEGATION_UUID,
        delegation_issued_at: NOW_ISO,
        delegation_expires_at: FUTURE_ISO,
        delegation_reason: "reason A",
      },
      SECRET,
    );
    const sig2 = await createDelegationSignature(
      {
        delegated_team_uuid: TEAM_UUID,
        delegator_role: "platform",
        scope: ["write"],
        delegation_uuid: DELEGATION_UUID,
        delegation_issued_at: NOW_ISO,
        delegation_expires_at: FUTURE_ISO,
        delegation_reason: "reason A",
      },
      SECRET,
    );
    expect(sig1).not.toBe(sig2);
  });

  it("produces consistent signatures for same payload", async () => {
    const payload = {
      delegated_team_uuid: TEAM_UUID,
      delegator_role: "platform" as const,
      scope: ["read" as const],
      delegation_uuid: DELEGATION_UUID,
      delegation_issued_at: NOW_ISO,
      delegation_expires_at: FUTURE_ISO,
      delegation_reason: "reason",
    };
    const sig1 = await createDelegationSignature(payload, SECRET);
    const sig2 = await createDelegationSignature(payload, SECRET);
    expect(sig1).toBe(sig2);
  });
});
