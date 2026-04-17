import { describe, it, expect, beforeAll } from "vitest";
import {
  NacpSemverSchema,
  NacpPrioritySchema,
  NacpProducerRoleSchema,
  NacpProducerIdSchema,
  NacpDeliveryKindSchema,
  NacpHeaderSchema,
  NacpAuthoritySchema,
  NacpTraceSchema,
  NacpControlSchema,
  NacpRefSchema,
  NacpEnvelopeBaseSchema,
  registerMessageType,
  validateEnvelope,
  encodeEnvelope,
  decodeEnvelope,
  NACP_MESSAGE_TYPES_ALL,
} from "../src/envelope.js";
import { NacpValidationError } from "../src/errors.js";
import { NACP_VERSION } from "../src/version.js";
import { z } from "zod";

// ── Test fixtures ──

const VALID_PRODUCER_ID = "nano-agent.session.do@v1";
const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const VALID_SENT_AT = "2026-04-16T00:00:00.000+00:00";
const VALID_TEAM_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeValidHeader(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: NACP_VERSION,
    message_uuid: VALID_UUID,
    message_type: "test.ping",
    delivery_kind: "command",
    sent_at: VALID_SENT_AT,
    producer_role: "session",
    producer_id: VALID_PRODUCER_ID,
    priority: "normal",
    ...overrides,
  };
}

function makeValidAuthority(overrides: Record<string, unknown> = {}) {
  return {
    team_uuid: VALID_TEAM_UUID,
    plan_level: "pro",
    stamped_by: "nano-agent.platform.ingress@v1",
    stamped_at: VALID_SENT_AT,
    ...overrides,
  };
}

function makeValidTrace(overrides: Record<string, unknown> = {}) {
  return {
    trace_id: VALID_UUID,
    session_uuid: VALID_UUID,
    ...overrides,
  };
}

function makeValidEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    header: makeValidHeader(),
    authority: makeValidAuthority(),
    trace: makeValidTrace(),
    ...overrides,
  };
}

// Register a test message type so validate Layer 2 passes
beforeAll(() => {
  registerMessageType(
    "test.ping",
    z.object({ msg: z.string() }),
    { bodyRequired: false, allowedProducerRoles: ["session", "platform"] },
  );
  registerMessageType(
    "test.strict",
    z.object({ required_field: z.string() }),
    { bodyRequired: true, allowedProducerRoles: ["session"] },
  );
});

// ═══════════════════════════════════════════════════════════════
// §1 — Primitive schemas
// ═══════════════════════════════════════════════════════════════

describe("NacpSemverSchema", () => {
  it("accepts valid semver", () => {
    expect(NacpSemverSchema.parse("1.0.0")).toBe("1.0.0");
    expect(NacpSemverSchema.parse("0.1.2")).toBe("0.1.2");
    expect(NacpSemverSchema.parse("10.20.30")).toBe("10.20.30");
  });
  it("rejects invalid semver", () => {
    expect(() => NacpSemverSchema.parse("1.0")).toThrow();
    expect(() => NacpSemverSchema.parse("abc")).toThrow();
    expect(() => NacpSemverSchema.parse("")).toThrow();
  });
});

describe("NacpPrioritySchema", () => {
  it("accepts all 4 values", () => {
    for (const v of ["low", "normal", "high", "urgent"]) {
      expect(NacpPrioritySchema.parse(v)).toBe(v);
    }
  });
  it("rejects unknown priority", () => {
    expect(() => NacpPrioritySchema.parse("critical")).toThrow();
  });
});

describe("NacpProducerRoleSchema", () => {
  it("accepts all 8 roles", () => {
    for (const r of ["session", "hook", "skill", "capability", "queue", "ingress", "client", "platform"]) {
      expect(NacpProducerRoleSchema.parse(r)).toBe(r);
    }
  });
  it("rejects unknown role", () => {
    expect(() => NacpProducerRoleSchema.parse("admin")).toThrow();
  });
});

describe("NacpProducerIdSchema", () => {
  it("accepts valid namespaced IDs", () => {
    expect(NacpProducerIdSchema.parse("nano-agent.session.do@v1")).toBe("nano-agent.session.do@v1");
    expect(NacpProducerIdSchema.parse("acme.plugin.foo@v2")).toBe("acme.plugin.foo@v2");
  });
  it("rejects invalid IDs", () => {
    expect(() => NacpProducerIdSchema.parse("no-version")).toThrow();
    expect(() => NacpProducerIdSchema.parse("x@v1")).toThrow(); // too short / no dot
    expect(() => NacpProducerIdSchema.parse("UPPER.case@v1")).toThrow();
    expect(() => NacpProducerIdSchema.parse("")).toThrow();
  });
});

describe("NacpDeliveryKindSchema", () => {
  it("accepts all 4 kinds", () => {
    for (const k of ["command", "response", "event", "error"]) {
      expect(NacpDeliveryKindSchema.parse(k)).toBe(k);
    }
  });
  it("rejects unknown kind", () => {
    expect(() => NacpDeliveryKindSchema.parse("notification")).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// §2 — Header
// ═══════════════════════════════════════════════════════════════

describe("NacpHeaderSchema", () => {
  it("accepts valid header", () => {
    const result = NacpHeaderSchema.parse(makeValidHeader());
    expect(result.message_type).toBe("test.ping");
    expect(result.producer_role).toBe("session");
  });

  it("defaults priority to normal", () => {
    const { priority, ...rest } = makeValidHeader();
    const result = NacpHeaderSchema.parse(rest);
    expect(result.priority).toBe("normal");
  });

  it("rejects missing message_uuid", () => {
    const { message_uuid, ...rest } = makeValidHeader();
    expect(() => NacpHeaderSchema.parse(rest)).toThrow();
  });

  it("rejects invalid producer_id format", () => {
    expect(() => NacpHeaderSchema.parse(makeValidHeader({ producer_id: "bad" }))).toThrow();
  });

  it("accepts optional consumer_hint", () => {
    const result = NacpHeaderSchema.parse(makeValidHeader({ consumer_hint: "nano-agent.skill.browser@v1" }));
    expect(result.consumer_hint).toBe("nano-agent.skill.browser@v1");
  });
});

// ═══════════════════════════════════════════════════════════════
// §3 — Authority (multi-tenant)
// ═══════════════════════════════════════════════════════════════

describe("NacpAuthoritySchema", () => {
  it("accepts valid authority with team_uuid", () => {
    const result = NacpAuthoritySchema.parse(makeValidAuthority());
    expect(result.team_uuid).toBe(VALID_TEAM_UUID);
  });

  it("accepts _platform as team_uuid", () => {
    const result = NacpAuthoritySchema.parse(makeValidAuthority({ team_uuid: "_platform" }));
    expect(result.team_uuid).toBe("_platform");
  });

  it("rejects empty team_uuid", () => {
    expect(() => NacpAuthoritySchema.parse(makeValidAuthority({ team_uuid: "" }))).toThrow();
  });

  it("requires stamped_by", () => {
    const { stamped_by, ...rest } = makeValidAuthority();
    expect(() => NacpAuthoritySchema.parse(rest)).toThrow();
  });

  it("requires stamped_at", () => {
    const { stamped_at, ...rest } = makeValidAuthority();
    expect(() => NacpAuthoritySchema.parse(rest)).toThrow();
  });

  it("accepts optional user_uuid", () => {
    const result = NacpAuthoritySchema.parse(makeValidAuthority({ user_uuid: VALID_UUID }));
    expect(result.user_uuid).toBe(VALID_UUID);
  });

  it("accepts optional membership_level", () => {
    const result = NacpAuthoritySchema.parse(makeValidAuthority({ membership_level: "admin" }));
    expect(result.membership_level).toBe("admin");
  });

  it("rejects invalid plan_level", () => {
    expect(() => NacpAuthoritySchema.parse(makeValidAuthority({ plan_level: "super" }))).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// §4 — Trace
// ═══════════════════════════════════════════════════════════════

describe("NacpTraceSchema", () => {
  it("accepts minimal trace", () => {
    const result = NacpTraceSchema.parse(makeValidTrace());
    expect(result.trace_id).toBe(VALID_UUID);
  });

  it("accepts full trace with stream fields", () => {
    const result = NacpTraceSchema.parse(makeValidTrace({
      parent_message_uuid: VALID_UUID,
      stream_id: "tool-call-42",
      stream_seq: 0,
      span_id: "abc123",
    }));
    expect(result.stream_seq).toBe(0);
  });

  it("rejects missing trace_id", () => {
    expect(() => NacpTraceSchema.parse({ session_uuid: VALID_UUID })).toThrow();
  });

  it("rejects negative stream_seq", () => {
    expect(() => NacpTraceSchema.parse(makeValidTrace({ stream_seq: -1 }))).toThrow();
  });

  it("rejects non-uuid trace_id", () => {
    expect(() => NacpTraceSchema.parse(makeValidTrace({ trace_id: "not-a-uuid" }))).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// §5 — Control (multi-tenant fields)
// ═══════════════════════════════════════════════════════════════

describe("NacpControlSchema", () => {
  it("accepts undefined (optional)", () => {
    expect(NacpControlSchema.parse(undefined)).toBeUndefined();
  });

  it("accepts minimal control", () => {
    const result = NacpControlSchema.parse({});
    expect(result?.audience).toBe("internal");
  });

  it("accepts full control with delegation + quota", () => {
    const result = NacpControlSchema.parse({
      reply_to: VALID_UUID,
      request_uuid: VALID_UUID,
      deadline_ms: 1700000000000,
      timeout_ms: 30000,
      idempotency_key: "key-42",
      capability_scope: ["browser:render"],
      audience: "client-visible",
      quota_hint: { plan_level: "pro", budget_remaining_ms: 45000 },
      tenant_delegation: {
        delegated_team_uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        delegator_role: "platform",
        scope: ["read"],
        delegation_uuid: VALID_UUID,
        delegation_issued_at: VALID_SENT_AT,
        delegation_expires_at: "2030-01-01T00:00:00.000+00:00",
        delegation_reason: "platform maintenance",
        signature: "hmac_hex_here",
      },
    });
    expect(result?.tenant_delegation?.delegated_team_uuid).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(result?.quota_hint?.budget_remaining_ms).toBe(45000);
  });

  it("rejects timeout_ms below 100", () => {
    expect(() => NacpControlSchema.parse({ timeout_ms: 50 })).toThrow();
  });

  it("rejects timeout_ms above 300000", () => {
    expect(() => NacpControlSchema.parse({ timeout_ms: 500_000 })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// §6 — Refs (tenant-namespaced)
// ═══════════════════════════════════════════════════════════════

describe("NacpRefSchema", () => {
  const validRef = {
    kind: "r2" as const,
    binding: "R2_WORKSPACE",
    team_uuid: VALID_TEAM_UUID,
    key: `tenants/${VALID_TEAM_UUID}/sessions/xyz/file.json`,
    role: "input" as const,
  };

  it("accepts valid ref with correct tenant prefix", () => {
    const result = NacpRefSchema.parse(validRef);
    expect(result.kind).toBe("r2");
  });

  it("rejects ref.key without tenant prefix", () => {
    expect(() => NacpRefSchema.parse({ ...validRef, key: "sessions/xyz/file.json" })).toThrow();
  });

  it("rejects ref.key with wrong team in prefix", () => {
    expect(() =>
      NacpRefSchema.parse({ ...validRef, key: "tenants/wrong-team/file.json" }),
    ).toThrow();
  });

  it("accepts _platform team in ref", () => {
    const result = NacpRefSchema.parse({
      ...validRef,
      team_uuid: "_platform",
      key: "tenants/_platform/shared/config.json",
    });
    expect(result.team_uuid).toBe("_platform");
  });

  it("accepts all 5 ref kinds", () => {
    for (const kind of ["r2", "kv", "do-storage", "d1", "queue-dlq"]) {
      const result = NacpRefSchema.parse({ ...validRef, kind });
      expect(result.kind).toBe(kind);
    }
  });

  it("defaults role to attachment", () => {
    const { role, ...rest } = validRef;
    const result = NacpRefSchema.parse(rest);
    expect(result.role).toBe("attachment");
  });

  it("rejects empty binding", () => {
    expect(() => NacpRefSchema.parse({ ...validRef, binding: "" })).toThrow();
  });

  it("rejects key longer than 512", () => {
    expect(() =>
      NacpRefSchema.parse({
        ...validRef,
        key: `tenants/${VALID_TEAM_UUID}/${"x".repeat(500)}`,
      }),
    ).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// §7 — Envelope composite
// ═══════════════════════════════════════════════════════════════

describe("NacpEnvelopeBaseSchema", () => {
  it("accepts valid minimal envelope", () => {
    const result = NacpEnvelopeBaseSchema.parse(makeValidEnvelope());
    expect(result.header.message_type).toBe("test.ping");
    expect(result.authority.team_uuid).toBe(VALID_TEAM_UUID);
  });

  it("rejects envelope missing header", () => {
    const { header, ...rest } = makeValidEnvelope();
    expect(() => NacpEnvelopeBaseSchema.parse(rest)).toThrow();
  });

  it("rejects envelope missing authority", () => {
    const { authority, ...rest } = makeValidEnvelope();
    expect(() => NacpEnvelopeBaseSchema.parse(rest)).toThrow();
  });

  it("rejects envelope missing trace", () => {
    const { trace, ...rest } = makeValidEnvelope();
    expect(() => NacpEnvelopeBaseSchema.parse(rest)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// §8 — validateEnvelope (5 layers)
// ═══════════════════════════════════════════════════════════════

describe("validateEnvelope", () => {
  // Layer 1: structural shape
  describe("Layer 1 — shape", () => {
    it("accepts valid envelope", () => {
      const result = validateEnvelope(makeValidEnvelope());
      expect(result.header.message_type).toBe("test.ping");
    });

    it("rejects non-object input", () => {
      expect(() => validateEnvelope("string")).toThrow(NacpValidationError);
      expect(() => validateEnvelope(null)).toThrow(NacpValidationError);
      expect(() => validateEnvelope(42)).toThrow(NacpValidationError);
    });

    it("rejects envelope with invalid header field", () => {
      const env = makeValidEnvelope();
      (env.header as any).producer_role = "invalid_role";
      expect(() => validateEnvelope(env)).toThrow(NacpValidationError);
    });
  });

  // Layer 2: message_type registry
  describe("Layer 2 — registry", () => {
    it("rejects unknown message_type", () => {
      const env = makeValidEnvelope();
      env.header.message_type = "unknown.nonexistent";
      try {
        validateEnvelope(env);
        expect.fail("should throw");
      } catch (e) {
        expect(e).toBeInstanceOf(NacpValidationError);
        expect((e as NacpValidationError).code).toBe("NACP_UNKNOWN_MESSAGE_TYPE");
      }
    });
  });

  // Layer 3: version compatibility
  describe("Layer 3 — version", () => {
    it("rejects version below compat floor", () => {
      const env = makeValidEnvelope();
      env.header.schema_version = "0.9.0";
      try {
        validateEnvelope(env);
        expect.fail("should throw");
      } catch (e) {
        expect(e).toBeInstanceOf(NacpValidationError);
        expect((e as NacpValidationError).code).toBe("NACP_VERSION_INCOMPATIBLE");
      }
    });

    it("accepts current version", () => {
      const result = validateEnvelope(makeValidEnvelope());
      expect(result.header.schema_version).toBe(NACP_VERSION);
    });

    it("accepts future patch version", () => {
      const env = makeValidEnvelope();
      env.header.schema_version = "1.0.1";
      const result = validateEnvelope(env);
      expect(result.header.schema_version).toBe("1.0.1");
    });
  });

  // Layer 4: per-type body
  describe("Layer 4 — body", () => {
    it("accepts envelope with optional body (test.ping)", () => {
      const result = validateEnvelope(makeValidEnvelope());
      expect(result.body).toBeUndefined();
    });

    it("validates body schema when body is present", () => {
      const env = makeValidEnvelope({ body: { msg: "hello" } });
      const result = validateEnvelope(env);
      expect(result.body).toEqual({ msg: "hello" });
    });

    it("rejects invalid body schema", () => {
      const env = makeValidEnvelope({ body: { msg: 42 } });
      expect(() => validateEnvelope(env)).toThrow(NacpValidationError);
    });

    it("rejects missing body when body is required", () => {
      const env = makeValidEnvelope();
      env.header.message_type = "test.strict";
      env.header.producer_role = "session";
      expect(() => validateEnvelope(env)).toThrow(NacpValidationError);
    });

    it("accepts valid body for body-required type", () => {
      const env = makeValidEnvelope({ body: { required_field: "yes" } });
      env.header.message_type = "test.strict";
      env.header.producer_role = "session";
      const result = validateEnvelope(env);
      expect((result.body as any).required_field).toBe("yes");
    });
  });

  // Layer 5: role gate
  describe("Layer 5 — role gate", () => {
    it("accepts allowed producer_role", () => {
      const result = validateEnvelope(makeValidEnvelope());
      expect(result.header.producer_role).toBe("session");
    });

    it("rejects disallowed producer_role", () => {
      const env = makeValidEnvelope();
      env.header.producer_role = "skill";
      try {
        validateEnvelope(env);
        expect.fail("should throw");
      } catch (e) {
        expect(e).toBeInstanceOf(NacpValidationError);
        expect((e as NacpValidationError).code).toBe("NACP_PRODUCER_ROLE_MISMATCH");
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// §9 — encodeEnvelope / decodeEnvelope
// ═══════════════════════════════════════════════════════════════

describe("encodeEnvelope", () => {
  it("returns valid JSON string", () => {
    const json = encodeEnvelope(makeValidEnvelope());
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed.header.message_type).toBe("test.ping");
  });

  it("throws on oversized envelope", () => {
    const env = makeValidEnvelope({ extra: { huge: "x".repeat(200_000) } });
    expect(() => encodeEnvelope(env)).toThrow(NacpValidationError);
  });
});

describe("decodeEnvelope", () => {
  it("round-trips with encodeEnvelope", () => {
    const original = makeValidEnvelope({ body: { msg: "roundtrip" } });
    const json = encodeEnvelope(original);
    const decoded = decodeEnvelope(json);
    expect(decoded.header.message_type).toBe("test.ping");
    expect((decoded.body as any).msg).toBe("roundtrip");
  });

  it("rejects invalid JSON", () => {
    expect(() => decodeEnvelope("not-json")).toThrow(NacpValidationError);
  });

  it("rejects oversized raw string", () => {
    const huge = "x".repeat(96 * 1024 * 3);
    expect(() => decodeEnvelope(huge)).toThrow(NacpValidationError);
  });
});
