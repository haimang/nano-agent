import { describe, it, expect } from "vitest";
import {
  isMessageAllowedInPhase,
  assertPhaseAllowed,
  getExpectedResponseType,
  NACP_ROLE_REQUIREMENTS,
  assertRoleCoversRequired,
  type SessionPhase,
} from "../src/state-machine.js";

describe("session phase state machine", () => {
  describe("unattached phase", () => {
    const phase: SessionPhase = "unattached";
    it("allows session.start", () => expect(isMessageAllowedInPhase(phase, "session.start")).toBe(true));
    it("allows session.resume", () => expect(isMessageAllowedInPhase(phase, "session.resume")).toBe(true));
    it("allows system.error", () => expect(isMessageAllowedInPhase(phase, "system.error")).toBe(true));
    it("blocks tool.call.request", () => expect(isMessageAllowedInPhase(phase, "tool.call.request")).toBe(false));
    it("blocks session.cancel", () => expect(isMessageAllowedInPhase(phase, "session.cancel")).toBe(false));
    it("blocks hook.emit", () => expect(isMessageAllowedInPhase(phase, "hook.emit")).toBe(false));
  });

  describe("attached phase", () => {
    const phase: SessionPhase = "attached";
    it("allows session.end", () => expect(isMessageAllowedInPhase(phase, "session.end")).toBe(true));
    it("allows tool.call.request", () => expect(isMessageAllowedInPhase(phase, "tool.call.request")).toBe(true));
    it("allows hook.emit", () => expect(isMessageAllowedInPhase(phase, "hook.emit")).toBe(true));
    it("allows context.compact.request", () => expect(isMessageAllowedInPhase(phase, "context.compact.request")).toBe(true));
    it("blocks session.start", () => expect(isMessageAllowedInPhase(phase, "session.start")).toBe(false));
    it("blocks session.resume", () => expect(isMessageAllowedInPhase(phase, "session.resume")).toBe(false));
  });

  describe("turn_running phase", () => {
    const phase: SessionPhase = "turn_running";
    it("allows tool.call.request", () => expect(isMessageAllowedInPhase(phase, "tool.call.request")).toBe(true));
    it("allows tool.call.response", () => expect(isMessageAllowedInPhase(phase, "tool.call.response")).toBe(true));
    it("allows tool.call.cancel", () => expect(isMessageAllowedInPhase(phase, "tool.call.cancel")).toBe(true));
    it("allows hook.emit", () => expect(isMessageAllowedInPhase(phase, "hook.emit")).toBe(true));
    it("allows hook.outcome", () => expect(isMessageAllowedInPhase(phase, "hook.outcome")).toBe(true));
    it("allows session.cancel", () => expect(isMessageAllowedInPhase(phase, "session.cancel")).toBe(true));
    it("allows session.end", () => expect(isMessageAllowedInPhase(phase, "session.end")).toBe(true));
    it("allows context.compact.request", () => expect(isMessageAllowedInPhase(phase, "context.compact.request")).toBe(true));
    it("allows context.compact.response", () => expect(isMessageAllowedInPhase(phase, "context.compact.response")).toBe(true));
    it("blocks session.start", () => expect(isMessageAllowedInPhase(phase, "session.start")).toBe(false));
    it("blocks session.resume", () => expect(isMessageAllowedInPhase(phase, "session.resume")).toBe(false));
  });

  describe("ended phase", () => {
    const phase: SessionPhase = "ended";
    it("allows system.error", () => expect(isMessageAllowedInPhase(phase, "system.error")).toBe(true));
    it("allows audit.record", () => expect(isMessageAllowedInPhase(phase, "audit.record")).toBe(true));
    it("blocks tool.call.request", () => expect(isMessageAllowedInPhase(phase, "tool.call.request")).toBe(false));
    it("blocks session.cancel", () => expect(isMessageAllowedInPhase(phase, "session.cancel")).toBe(false));
    it("blocks hook.emit", () => expect(isMessageAllowedInPhase(phase, "hook.emit")).toBe(false));
  });
});

describe("assertPhaseAllowed", () => {
  it("does not throw for allowed message", () => {
    expect(() => assertPhaseAllowed("attached", "tool.call.request")).not.toThrow();
  });

  it("throws for disallowed message", () => {
    expect(() => assertPhaseAllowed("ended", "tool.call.request")).toThrow(
      "NACP_STATE_MACHINE_VIOLATION",
    );
  });
});

describe("request/response pairing", () => {
  it("pairs tool.call.request → tool.call.response", () => {
    expect(getExpectedResponseType("tool.call.request")).toBe("tool.call.response");
  });
  it("pairs skill.invoke.request → skill.invoke.response", () => {
    expect(getExpectedResponseType("skill.invoke.request")).toBe("skill.invoke.response");
  });
  it("pairs context.compact.request → context.compact.response", () => {
    expect(getExpectedResponseType("context.compact.request")).toBe("context.compact.response");
  });
  it("pairs hook.emit → hook.outcome", () => {
    expect(getExpectedResponseType("hook.emit")).toBe("hook.outcome");
  });
  it("returns undefined for non-command types", () => {
    expect(getExpectedResponseType("system.error")).toBeUndefined();
  });
});

describe("NACP_ROLE_REQUIREMENTS", () => {
  it("defines all 8 roles", () => {
    const roles = ["session", "capability", "skill", "hook", "client", "queue", "ingress", "platform"];
    for (const role of roles) {
      expect(NACP_ROLE_REQUIREMENTS[role], `missing role: ${role}`).toBeDefined();
    }
  });

  it("session has the widest producer set", () => {
    expect(NACP_ROLE_REQUIREMENTS.session.producer.size).toBeGreaterThanOrEqual(5);
  });

  it("ingress has empty sets", () => {
    expect(NACP_ROLE_REQUIREMENTS.ingress.producer.size).toBe(0);
    expect(NACP_ROLE_REQUIREMENTS.ingress.consumer.size).toBe(0);
  });
});

describe("assertRoleCoversRequired", () => {
  it("returns empty missing arrays when fully covered", () => {
    const { missingProducer, missingConsumer } = assertRoleCoversRequired("hook", {
      canProduce: new Set(["hook.outcome", "system.error"]),
      canConsume: new Set(["hook.emit"]),
    });
    expect(missingProducer).toEqual([]);
    expect(missingConsumer).toEqual([]);
  });

  it("reports missing consumer types", () => {
    const { missingConsumer } = assertRoleCoversRequired("hook", {
      canProduce: new Set(["hook.outcome", "system.error"]),
      canConsume: new Set([]),
    });
    expect(missingConsumer).toContain("hook.emit");
  });

  it("reports missing producer types", () => {
    const { missingProducer } = assertRoleCoversRequired("skill", {
      canProduce: new Set([]),
      canConsume: new Set(["skill.invoke.request"]),
    });
    expect(missingProducer).toContain("skill.invoke.response");
  });

  it("returns empty for unknown role", () => {
    const { missingProducer, missingConsumer } = assertRoleCoversRequired("nonexistent", {
      canProduce: new Set(),
      canConsume: new Set(),
    });
    expect(missingProducer).toEqual([]);
    expect(missingConsumer).toEqual([]);
  });
});
