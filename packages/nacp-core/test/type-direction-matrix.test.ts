import { describe, it, expect } from "vitest";
// Import from package index to trigger message-type registration side effects.
import {
  NACP_CORE_TYPE_DIRECTION_MATRIX,
  isLegalCoreDirection,
  validateEnvelope,
  NACP_VERSION,
} from "../src/index.js";
import { NacpValidationError } from "../src/errors.js";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const VALID_SENT_AT = "2026-04-21T00:00:00.000+00:00";
const VALID_TEAM_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeEnv(type: string, deliveryKind: string, body: unknown = {}) {
  return {
    header: {
      schema_version: NACP_VERSION,
      message_uuid: VALID_UUID,
      message_type: type,
      delivery_kind: deliveryKind,
      sent_at: VALID_SENT_AT,
      producer_role: "session",
      producer_key: "nano-agent.session.do@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: VALID_TEAM_UUID,
      plan_level: "pro",
      stamped_by_key: "nano-agent.platform.ingress@v1",
      stamped_at: VALID_SENT_AT,
    },
    trace: {
      trace_uuid: VALID_UUID,
      session_uuid: VALID_UUID,
    },
    body,
  };
}

describe("NACP_CORE_TYPE_DIRECTION_MATRIX", () => {
  it("covers every core-registered type", () => {
    const expected = [
      "tool.call.request",
      "tool.call.response",
      "tool.call.cancel",
      "hook.emit",
      "hook.outcome",
      "skill.invoke.request",
      "skill.invoke.response",
      "context.compact.request",
      "context.compact.response",
      "system.error",
      "audit.record",
    ];
    for (const t of expected) {
      expect(NACP_CORE_TYPE_DIRECTION_MATRIX[t]).toBeDefined();
      expect(NACP_CORE_TYPE_DIRECTION_MATRIX[t]!.size).toBeGreaterThan(0);
    }
  });

  it("is-legal returns true for known legal combo", () => {
    expect(isLegalCoreDirection("tool.call.request", "command")).toBe(true);
    expect(isLegalCoreDirection("tool.call.response", "response")).toBe(true);
    expect(isLegalCoreDirection("tool.call.response", "error")).toBe(true);
  });

  it("is-legal returns false for known illegal combo", () => {
    expect(isLegalCoreDirection("tool.call.request", "event")).toBe(false);
    expect(isLegalCoreDirection("hook.emit", "command")).toBe(false);
  });

  it("is-legal fails open for unknown type (session.*)", () => {
    expect(isLegalCoreDirection("session.start", "command")).toBe(true);
    expect(isLegalCoreDirection("future.whatever", "event")).toBe(true);
  });
});

describe("validateEnvelope() Layer 6 — type×direction matrix", () => {
  it("accepts tool.call.request with delivery_kind=command", () => {
    const env = makeEnv("tool.call.request", "command", {
      tool_name: "bash",
      tool_input: { command: "ls" },
    });
    expect(() => validateEnvelope(env)).not.toThrow();
  });

  it("rejects tool.call.request with delivery_kind=event", () => {
    const env = makeEnv("tool.call.request", "event", {
      tool_name: "bash",
      tool_input: { command: "ls" },
    });
    expect(() => validateEnvelope(env)).toThrow(NacpValidationError);
    try {
      validateEnvelope(env);
    } catch (err) {
      expect((err as NacpValidationError).code).toBe(
        "NACP_TYPE_DIRECTION_MISMATCH",
      );
    }
  });

  it("accepts hook.emit with delivery_kind=event", () => {
    const env = makeEnv("hook.emit", "event", {
      event_name: "test.fired",
      event_payload: {},
    });
    expect(() => validateEnvelope(env)).not.toThrow();
  });

  it("rejects hook.emit with delivery_kind=command", () => {
    const env = makeEnv("hook.emit", "command", {
      event_name: "test.fired",
      event_payload: {},
    });
    expect(() => validateEnvelope(env)).toThrow(NacpValidationError);
  });

  it("accepts system.error with delivery_kind=error", () => {
    const env = makeEnv("system.error", "error", {
      error: {
        code: "TEST",
        category: "validation",
        message: "test",
        retryable: false,
      },
    });
    expect(() => validateEnvelope(env)).not.toThrow();
  });
});
