/**
 * ZX2 Phase 2 P2-03 — 5 family / 7 message_type tests.
 *
 * Covers: permission.request/decision, usage.update, skill.invoke,
 * command.invoke, elicitation.request/answer.
 */

import { describe, it, expect } from "vitest";
import {
  SessionPermissionRequestBodySchema,
  SessionPermissionDecisionBodySchema,
  SessionUsageUpdateBodySchema,
  SessionSkillInvokeBodySchema,
  SessionCommandInvokeBodySchema,
  SessionElicitationRequestBodySchema,
  SessionElicitationAnswerBodySchema,
  SESSION_BODY_SCHEMAS,
  SESSION_BODY_REQUIRED,
  SESSION_MESSAGE_TYPES,
} from "../src/messages.js";
import {
  NACP_SESSION_TYPE_DIRECTION_MATRIX,
  isLegalSessionDirection,
} from "../src/type-direction-matrix.js";
import {
  SESSION_ROLE_REQUIREMENTS,
  assertSessionRoleAllowed,
  isSessionMessageAllowedInPhase,
} from "../src/session-registry.js";
import { NacpSessionError } from "../src/errors.js";

const REQ = "11111111-1111-4111-8111-111111111111";
const REQ2 = "22222222-2222-4222-8222-222222222222";

describe("session.permission.request", () => {
  it("requires request_uuid + tool_name + tool_input", () => {
    expect(() => SessionPermissionRequestBodySchema.parse({})).toThrow();
    const ok = SessionPermissionRequestBodySchema.parse({
      request_uuid: REQ,
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    expect(ok.tool_name).toBe("Bash");
  });

  it("accepts optional reason / blocked_path / expires_at / suggested_decision", () => {
    const ok = SessionPermissionRequestBodySchema.parse({
      request_uuid: REQ,
      tool_name: "FileEdit",
      tool_input: { path: "/etc/passwd" },
      reason: "writes outside workspace",
      blocked_path: "/etc/passwd",
      expires_at: "2026-04-27T00:00:30.000+00:00",
      suggested_decision: "deny",
    });
    expect(ok.suggested_decision).toBe("deny");
  });

  it("rejects bad suggested_decision", () => {
    expect(() =>
      SessionPermissionRequestBodySchema.parse({
        request_uuid: REQ,
        tool_name: "Bash",
        tool_input: {},
        suggested_decision: "maybe",
      }),
    ).toThrow();
  });
});

describe("session.permission.decision", () => {
  it("requires request_uuid + decision; defaults scope=once", () => {
    const ok = SessionPermissionDecisionBodySchema.parse({
      request_uuid: REQ,
      decision: "allow",
    });
    expect(ok.scope).toBe("once");
  });

  it("supports always_allow / always_deny + scope override", () => {
    const ok = SessionPermissionDecisionBodySchema.parse({
      request_uuid: REQ,
      decision: "always_allow",
      scope: "user",
    });
    expect(ok.decision).toBe("always_allow");
    expect(ok.scope).toBe("user");
  });

  it("rejects unknown scope", () => {
    expect(() =>
      SessionPermissionDecisionBodySchema.parse({
        request_uuid: REQ,
        decision: "allow",
        scope: "forever",
      }),
    ).toThrow();
  });
});

describe("session.usage.update", () => {
  it("accepts an empty body (no fields required)", () => {
    expect(SessionUsageUpdateBodySchema.parse({})).toEqual({});
  });

  it("accepts a fully-populated update", () => {
    const ok = SessionUsageUpdateBodySchema.parse({
      llm_input_tokens: 1000,
      llm_output_tokens: 500,
      llm_cache_read_tokens: 800,
      llm_cache_write_tokens: 200,
      tool_calls: 3,
      subrequest_used: 2,
      subrequest_budget: 50,
      estimated_cost_usd: 0.012,
    });
    expect(ok.tool_calls).toBe(3);
    expect(ok.estimated_cost_usd).toBe(0.012);
  });

  it("rejects negative tokens", () => {
    expect(() =>
      SessionUsageUpdateBodySchema.parse({ llm_input_tokens: -1 }),
    ).toThrow();
  });
});

describe("session.skill.invoke", () => {
  it("requires skill_name", () => {
    expect(() => SessionSkillInvokeBodySchema.parse({})).toThrow();
    expect(
      SessionSkillInvokeBodySchema.parse({ skill_name: "review" }),
    ).toEqual({ skill_name: "review" });
  });

  it("accepts args + request_uuid", () => {
    const ok = SessionSkillInvokeBodySchema.parse({
      skill_name: "schedule",
      args: { cadence: "weekly" },
      request_uuid: REQ,
    });
    expect(ok.args).toEqual({ cadence: "weekly" });
  });
});

describe("session.command.invoke", () => {
  it("requires command_name", () => {
    expect(() => SessionCommandInvokeBodySchema.parse({})).toThrow();
    expect(
      SessionCommandInvokeBodySchema.parse({ command_name: "loop" }),
    ).toEqual({ command_name: "loop" });
  });

  it("accepts args string + request_uuid", () => {
    const ok = SessionCommandInvokeBodySchema.parse({
      command_name: "loop",
      args: "5m /babysit",
      request_uuid: REQ,
    });
    expect(ok.args).toBe("5m /babysit");
  });
});

describe("session.elicitation.request", () => {
  it("requires request_uuid + prompt", () => {
    expect(() => SessionElicitationRequestBodySchema.parse({})).toThrow();
    const ok = SessionElicitationRequestBodySchema.parse({
      request_uuid: REQ,
      prompt: "Pick one",
    });
    expect(ok.prompt).toBe("Pick one");
  });

  it("accepts answer_schema + expires_at", () => {
    const ok = SessionElicitationRequestBodySchema.parse({
      request_uuid: REQ,
      prompt: "Pick one",
      answer_schema: { type: "string", enum: ["yes", "no"] },
      expires_at: "2026-04-27T00:00:30.000+00:00",
    });
    expect(ok.answer_schema).toBeDefined();
  });
});

describe("session.elicitation.answer", () => {
  it("requires request_uuid + answer", () => {
    expect(() => SessionElicitationAnswerBodySchema.parse({})).toThrow();
    const ok = SessionElicitationAnswerBodySchema.parse({
      request_uuid: REQ,
      answer: "yes",
    });
    expect(ok.answer).toBe("yes");
  });

  it("supports cancelled flag", () => {
    const ok = SessionElicitationAnswerBodySchema.parse({
      request_uuid: REQ2,
      answer: null,
      cancelled: true,
    });
    expect(ok.cancelled).toBe(true);
  });
});

describe("registry / matrix / role inclusion", () => {
  const NEW_TYPES = [
    "session.permission.request",
    "session.permission.decision",
    "session.usage.update",
    "session.skill.invoke",
    "session.command.invoke",
    "session.elicitation.request",
    "session.elicitation.answer",
  ];

  it("SESSION_MESSAGE_TYPES contains all 7 new types", () => {
    for (const t of NEW_TYPES) {
      expect(SESSION_MESSAGE_TYPES.has(t)).toBe(true);
    }
  });

  it("SESSION_BODY_SCHEMAS maps each new type to a schema", () => {
    for (const t of NEW_TYPES) {
      expect((SESSION_BODY_SCHEMAS as Record<string, unknown>)[t]).toBeDefined();
    }
  });

  it("SESSION_BODY_REQUIRED includes all 7 new types", () => {
    for (const t of NEW_TYPES) {
      expect(SESSION_BODY_REQUIRED.has(t)).toBe(true);
    }
  });

  it("type-direction matrix has entries for new types", () => {
    for (const t of NEW_TYPES) {
      expect(NACP_SESSION_TYPE_DIRECTION_MATRIX[t]).toBeDefined();
    }
  });

  it("isLegalSessionDirection accepts canonical kinds", () => {
    expect(isLegalSessionDirection("session.permission.request", "command")).toBe(true);
    expect(isLegalSessionDirection("session.permission.request", "event")).toBe(true);
    expect(isLegalSessionDirection("session.permission.decision", "response")).toBe(true);
    expect(isLegalSessionDirection("session.usage.update", "event")).toBe(true);
    expect(isLegalSessionDirection("session.usage.update", "command")).toBe(false);
  });

  it("client role can produce decision/skill/command/elicitation.answer", () => {
    expect(() =>
      assertSessionRoleAllowed(
        "client",
        "session.permission.decision",
        "produce",
      ),
    ).not.toThrow();
    expect(() =>
      assertSessionRoleAllowed("client", "session.skill.invoke", "produce"),
    ).not.toThrow();
    expect(() =>
      assertSessionRoleAllowed("client", "session.command.invoke", "produce"),
    ).not.toThrow();
    expect(() =>
      assertSessionRoleAllowed(
        "client",
        "session.elicitation.answer",
        "produce",
      ),
    ).not.toThrow();
  });

  it("client role can consume permission.request/usage.update/elicitation.request", () => {
    expect(() =>
      assertSessionRoleAllowed(
        "client",
        "session.permission.request",
        "consume",
      ),
    ).not.toThrow();
    expect(() =>
      assertSessionRoleAllowed("client", "session.usage.update", "consume"),
    ).not.toThrow();
    expect(() =>
      assertSessionRoleAllowed(
        "client",
        "session.elicitation.request",
        "consume",
      ),
    ).not.toThrow();
  });

  it("session role cannot produce permission.decision (it's client-produced)", () => {
    expect(() =>
      assertSessionRoleAllowed(
        "session",
        "session.permission.decision",
        "produce",
      ),
    ).toThrow(NacpSessionError);
  });

  it("phase: turn_running allows permission round-trip", () => {
    expect(
      isSessionMessageAllowedInPhase("turn_running", "session.permission.request"),
    ).toBe(true);
    expect(
      isSessionMessageAllowedInPhase("turn_running", "session.permission.decision"),
    ).toBe(true);
    expect(
      isSessionMessageAllowedInPhase("turn_running", "session.usage.update"),
    ).toBe(true);
  });

  it("phase: ended only allows usage.update + heartbeat", () => {
    expect(
      isSessionMessageAllowedInPhase("ended", "session.usage.update"),
    ).toBe(true);
    expect(isSessionMessageAllowedInPhase("ended", "session.heartbeat")).toBe(
      true,
    );
    expect(
      isSessionMessageAllowedInPhase("ended", "session.permission.request"),
    ).toBe(false);
  });
});
