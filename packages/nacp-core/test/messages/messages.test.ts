/**
 * Phase 4 tests — validate all 11 Core message types end-to-end.
 *
 * Strategy: for each message type, build a full envelope via makeEnvelope(),
 * run validateEnvelope(), and check both happy and failure paths.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  validateEnvelope,
  encodeEnvelope,
  decodeEnvelope,
  NACP_MESSAGE_TYPES_ALL,
  BODY_SCHEMAS,
  BODY_REQUIRED,
  ROLE_GATE,
  NACP_CORE_TYPE_DIRECTION_MATRIX,
} from "../../src/index.js";
import { NacpValidationError } from "../../src/errors.js";
import { NACP_VERSION } from "../../src/version.js";

const UUID = "11111111-1111-1111-1111-111111111111";
const TEAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SENT = "2026-04-16T00:00:00.000+00:00";

/**
 * B9 / 1.3: delivery_kind is now Layer-6 validated. Tests pick the first
 * legal delivery_kind from the matrix for each message_type, unless
 * overridden explicitly.
 */
function pickLegalDeliveryKind(messageType: string): string {
  const allowed = NACP_CORE_TYPE_DIRECTION_MATRIX[messageType];
  if (!allowed) return "command";
  return [...allowed][0]!;
}

function makeEnv(
  messageType: string,
  producerRole: string,
  body: unknown,
  deliveryKind: string = pickLegalDeliveryKind(messageType),
) {
  return {
    header: {
      schema_version: NACP_VERSION,
      message_uuid: UUID,
      message_type: messageType,
      delivery_kind: deliveryKind,
      sent_at: SENT,
      producer_role: producerRole,
      producer_key: `nano-agent.${producerRole}.test@v1`,
      priority: "normal",
    },
    authority: {
      team_uuid: TEAM,
      plan_level: "pro",
      stamped_by_key: "nano-agent.platform.ingress@v1",
      stamped_at: SENT,
    },
    trace: { trace_uuid: UUID, session_uuid: UUID },
    body,
  };
}

const REF_FIXTURE = {
  kind: "r2",
  binding: "R2_WORKSPACE",
  team_uuid: TEAM,
  key: `tenants/${TEAM}/sessions/${UUID}/attach/file.json`,
  role: "input",
};

describe("message type registration", () => {
  it("has registered all 11 Core message types (+ test types)", () => {
    const coreTypes = [
      "tool.call.request", "tool.call.response", "tool.call.cancel",
      "hook.emit", "hook.outcome",
      "skill.invoke.request", "skill.invoke.response",
      "context.compact.request", "context.compact.response",
      "system.error", "audit.record",
    ];
    for (const mt of coreTypes) {
      expect(NACP_MESSAGE_TYPES_ALL.has(mt), `missing: ${mt}`).toBe(true);
      expect(BODY_SCHEMAS[mt], `no body schema for ${mt}`).toBeDefined();
    }
  });

  it("marks body-required types correctly", () => {
    const required = [
      "tool.call.request", "tool.call.response",
      "hook.emit", "hook.outcome",
      "skill.invoke.request", "skill.invoke.response",
      "context.compact.request", "context.compact.response",
      "system.error", "audit.record",
    ];
    for (const mt of required) {
      expect(BODY_REQUIRED.has(mt), `should be body-required: ${mt}`).toBe(true);
    }
    expect(BODY_REQUIRED.has("tool.call.cancel")).toBe(false);
  });

  it("sets role gates for gated types", () => {
    expect(ROLE_GATE["tool.call.request"]).toBeDefined();
    expect(ROLE_GATE["tool.call.request"]!.has("session")).toBe(true);
    expect(ROLE_GATE["tool.call.response"]!.has("capability")).toBe(true);
    expect(ROLE_GATE["tool.call.response"]!.has("skill")).toBe(true);
    expect(ROLE_GATE["hook.outcome"]!.has("hook")).toBe(true);
  });

  it("does NOT set role gate for system.error (open to all)", () => {
    expect(ROLE_GATE["system.error"]).toBeUndefined();
  });
});

describe("tool.call.request", () => {
  it("validates happy path", () => {
    const result = validateEnvelope(makeEnv("tool.call.request", "session", {
      tool_name: "bash",
      tool_input: { command: "ls" },
    }));
    expect(result.header.message_type).toBe("tool.call.request");
  });

  it("rejects missing tool_name", () => {
    expect(() => validateEnvelope(makeEnv("tool.call.request", "session", {
      tool_input: { command: "ls" },
    }))).toThrow(NacpValidationError);
  });

  it("rejects wrong producer role", () => {
    expect(() => validateEnvelope(makeEnv("tool.call.request", "skill", {
      tool_name: "bash", tool_input: {},
    }))).toThrow(NacpValidationError);
  });
});

describe("tool.call.response", () => {
  it("validates happy path", () => {
    const result = validateEnvelope(makeEnv("tool.call.response", "capability", {
      status: "ok", output: "file.txt",
    }));
    expect(result.header.message_type).toBe("tool.call.response");
  });

  it("rejects invalid status", () => {
    expect(() => validateEnvelope(makeEnv("tool.call.response", "capability", {
      status: "partial",
    }))).toThrow(NacpValidationError);
  });
});

describe("tool.call.cancel", () => {
  it("validates with no body", () => {
    const env = makeEnv("tool.call.cancel", "session", undefined);
    const result = validateEnvelope(env);
    expect(result.body).toBeUndefined();
  });

  it("validates with reason", () => {
    const result = validateEnvelope(makeEnv("tool.call.cancel", "session", {
      reason: "user cancelled",
    }));
    expect(result.body).toBeDefined();
  });
});

describe("hook.emit", () => {
  it("validates happy path", () => {
    const result = validateEnvelope(makeEnv("hook.emit", "session", {
      event_name: "PreToolUse",
      event_payload: { tool_name: "bash" },
    }));
    expect(result.header.message_type).toBe("hook.emit");
  });

  it("rejects missing event_name", () => {
    expect(() => validateEnvelope(makeEnv("hook.emit", "session", {
      event_payload: {},
    }))).toThrow(NacpValidationError);
  });
});

describe("hook.outcome", () => {
  it("validates happy path", () => {
    const result = validateEnvelope(makeEnv("hook.outcome", "hook", {
      ok: true, additional_context: "context added by hook",
    }));
    expect(result.body).toBeDefined();
  });

  it("rejects missing ok field", () => {
    expect(() => validateEnvelope(makeEnv("hook.outcome", "hook", {
      block: { reason: "blocked" },
    }))).toThrow(NacpValidationError);
  });
});

describe("skill.invoke.request", () => {
  it("validates happy path", () => {
    const result = validateEnvelope(makeEnv("skill.invoke.request", "session", {
      skill_name: "pdf-generator",
    }));
    expect(result.body).toBeDefined();
  });
});

describe("skill.invoke.response", () => {
  it("validates happy path", () => {
    const result = validateEnvelope(makeEnv("skill.invoke.response", "skill", {
      status: "ok", result: "generated",
    }));
    expect(result.body).toBeDefined();
  });
});

describe("context.compact.request", () => {
  it("validates happy path", () => {
    const result = validateEnvelope(makeEnv("context.compact.request", "session", {
      history_ref: REF_FIXTURE,
      target_token_budget: 40_000,
    }));
    expect(result.body).toBeDefined();
  });

  it("rejects missing target_token_budget", () => {
    expect(() => validateEnvelope(makeEnv("context.compact.request", "session", {
      history_ref: REF_FIXTURE,
    }))).toThrow(NacpValidationError);
  });
});

describe("context.compact.response (GPT bug fix)", () => {
  it("validates happy path", () => {
    const result = validateEnvelope(makeEnv("context.compact.response", "capability", {
      status: "ok",
      tokens_before: 80_000,
      tokens_after: 35_000,
    }));
    expect(result.body).toBeDefined();
  });
});

describe("system.error", () => {
  it("validates from any role", () => {
    for (const role of ["session", "hook", "skill", "capability", "platform"]) {
      const result = validateEnvelope(makeEnv("system.error", role, {
        error: { code: "NACP_BINDING_UNAVAILABLE", category: "transient", message: "down", retryable: true },
      }));
      expect(result.header.producer_role).toBe(role);
    }
  });
});

describe("audit.record", () => {
  it("validates happy path", () => {
    const result = validateEnvelope(makeEnv("audit.record", "session", {
      event_kind: "tool.call.completed",
    }));
    expect(result.body).toBeDefined();
  });
});

describe("end-to-end encode → decode roundtrip", () => {
  it("roundtrips tool.call.request", () => {
    const env = makeEnv("tool.call.request", "session", {
      tool_name: "bash", tool_input: { command: "echo hello" },
    });
    const json = encodeEnvelope(env);
    const decoded = decodeEnvelope(json);
    expect((decoded.body as any).tool_name).toBe("bash");
  });

  it("roundtrips hook.outcome", () => {
    const env = makeEnv("hook.outcome", "hook", {
      ok: false, block: { reason: "dangerous" },
    });
    const json = encodeEnvelope(env);
    const decoded = decodeEnvelope(json);
    expect((decoded.body as any).ok).toBe(false);
  });
});
