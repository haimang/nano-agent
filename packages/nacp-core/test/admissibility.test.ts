import { describe, it, expect } from "vitest";
import { checkAdmissibility } from "../src/admissibility.js";
import { NacpAdmissibilityError } from "../src/errors.js";
import type { NacpEnvelope } from "../src/envelope.js";

function makeEnvelope(
  messageType = "tool.call.request",
  controlOverrides: Record<string, unknown> = {},
): NacpEnvelope {
  return {
    header: {
      schema_version: "1.0.0",
      message_uuid: "11111111-1111-1111-1111-111111111111",
      message_type: messageType,
      delivery_kind: "command",
      sent_at: new Date().toISOString(),
      producer_role: "session",
      producer_id: "nano-agent.session.do@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      plan_level: "pro",
      stamped_by: "nano-agent.platform.ingress@v1",
      stamped_at: new Date().toISOString(),
    },
    trace: {
      trace_id: "11111111-1111-1111-1111-111111111111",
      session_uuid: "22222222-2222-2222-2222-222222222222",
    },
    control: Object.keys(controlOverrides).length > 0 ? controlOverrides : undefined,
  } as NacpEnvelope;
}

describe("checkAdmissibility", () => {
  it("passes when no control is present", () => {
    expect(() => checkAdmissibility(makeEnvelope())).not.toThrow();
  });

  it("passes when deadline is in the future", () => {
    expect(() =>
      checkAdmissibility(makeEnvelope("tool.call.request", { deadline_ms: Date.now() + 60_000 })),
    ).not.toThrow();
  });

  it("throws NACP_DEADLINE_EXCEEDED when deadline is past", () => {
    try {
      checkAdmissibility(makeEnvelope("tool.call.request", { deadline_ms: Date.now() - 1000 }));
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(NacpAdmissibilityError);
      expect((e as NacpAdmissibilityError).code).toBe("NACP_DEADLINE_EXCEEDED");
    }
  });

  it("passes when capability scope is met", () => {
    expect(() =>
      checkAdmissibility(
        makeEnvelope("tool.call.request", { capability_scope: ["browser:render"] }),
        { granted_capabilities: new Set(["browser:render", "ai:chat"]) },
      ),
    ).not.toThrow();
  });

  it("throws NACP_CAPABILITY_DENIED when scope not met", () => {
    try {
      checkAdmissibility(
        makeEnvelope("tool.call.request", { capability_scope: ["browser:render"] }),
        { granted_capabilities: new Set(["ai:chat"]) },
      );
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(NacpAdmissibilityError);
      expect((e as NacpAdmissibilityError).code).toBe("NACP_CAPABILITY_DENIED");
    }
  });

  it("skips capability check when no granted set provided", () => {
    expect(() =>
      checkAdmissibility(makeEnvelope("tool.call.request", { capability_scope: ["browser:render"] })),
    ).not.toThrow();
  });

  // ── State machine checks (GPT code-review §2.3 fix) ──

  it("passes when message is allowed in current phase", () => {
    expect(() =>
      checkAdmissibility(makeEnvelope("tool.call.request"), {
        session_phase: "turn_running",
      }),
    ).not.toThrow();
  });

  it("throws NACP_STATE_MACHINE_VIOLATION when message not allowed in phase", () => {
    try {
      checkAdmissibility(makeEnvelope("tool.call.request"), {
        session_phase: "ended",
      });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(NacpAdmissibilityError);
      expect((e as NacpAdmissibilityError).code).toBe("NACP_STATE_MACHINE_VIOLATION");
    }
  });

  it("throws for session.start in turn_running phase", () => {
    try {
      checkAdmissibility(makeEnvelope("session.start"), {
        session_phase: "turn_running",
      });
      expect.fail("should throw");
    } catch (e) {
      expect((e as NacpAdmissibilityError).code).toBe("NACP_STATE_MACHINE_VIOLATION");
    }
  });

  it("allows system.error in any phase", () => {
    for (const phase of ["unattached", "attached", "turn_running", "ended"] as const) {
      expect(() =>
        checkAdmissibility(makeEnvelope("system.error"), { session_phase: phase }),
      ).not.toThrow();
    }
  });

  it("skips phase check when session_phase not provided", () => {
    expect(() => checkAdmissibility(makeEnvelope("tool.call.request"))).not.toThrow();
  });
});
