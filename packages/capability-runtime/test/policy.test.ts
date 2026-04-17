import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityPolicyGate } from "../src/policy.js";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import type { CapabilityPlan, CapabilityDeclaration } from "../src/types.js";

function makeDecl(name: string, policy: CapabilityDeclaration["policy"]): CapabilityDeclaration {
  return {
    name,
    kind: "filesystem",
    description: `Test: ${name}`,
    inputSchema: {},
    executionTarget: "local-ts",
    policy,
  };
}

function makePlan(capabilityName: string): CapabilityPlan {
  return {
    capabilityName,
    input: {},
    executionTarget: "local-ts",
    source: "bash-command",
  };
}

describe("CapabilityPolicyGate", () => {
  let registry: InMemoryCapabilityRegistry;
  let gate: CapabilityPolicyGate;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    gate = new CapabilityPolicyGate(registry);
  });

  it("returns 'allow' for capabilities with allow policy", async () => {
    registry.register(makeDecl("ls", "allow"));
    expect(await gate.check(makePlan("ls"))).toBe("allow");
  });

  it("returns 'ask' for capabilities with ask policy", async () => {
    registry.register(makeDecl("write", "ask"));
    expect(await gate.check(makePlan("write"))).toBe("ask");
  });

  it("returns 'deny' for capabilities with deny policy", async () => {
    registry.register(makeDecl("dangerous", "deny"));
    expect(await gate.check(makePlan("dangerous"))).toBe("deny");
  });

  it("returns 'deny' for unregistered capabilities", async () => {
    expect(await gate.check(makePlan("nonexistent"))).toBe("deny");
  });

  it("honours hook override: allow", async () => {
    registry.register(makeDecl("write", "ask"));
    expect(
      await gate.check(makePlan("write"), { hookOutcome: "allow" }),
    ).toBe("allow");
  });

  it("honours hook override: deny", async () => {
    registry.register(makeDecl("ls", "allow"));
    expect(
      await gate.check(makePlan("ls"), { hookOutcome: "deny" }),
    ).toBe("deny");
  });

  it("falls back to static policy when hookOutcome is not allow/deny", async () => {
    registry.register(makeDecl("ls", "allow"));
    expect(
      await gate.check(makePlan("ls"), { hookOutcome: "something-else" }),
    ).toBe("allow");
  });
});
