import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityExecutor } from "../src/executor.js";
import type { TargetHandler } from "../src/executor.js";
import { CapabilityPolicyGate } from "../src/policy.js";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import type { CapabilityPlan, ExecutionTarget } from "../src/types.js";
import type { CapabilityResult } from "../src/result.js";

function makeDecl(name: string, policy: "allow" | "ask" | "deny") {
  return {
    name,
    kind: "filesystem" as const,
    description: `Test: ${name}`,
    inputSchema: {},
    executionTarget: "local-ts" as const,
    policy,
  };
}

function makePlan(name: string): CapabilityPlan {
  return {
    capabilityName: name,
    input: { path: "/test" },
    executionTarget: "local-ts",
    source: "bash-command",
  };
}

class FakeTarget implements TargetHandler {
  lastPlan: CapabilityPlan | null = null;

  async execute(plan: CapabilityPlan): Promise<CapabilityResult> {
    this.lastPlan = plan;
    return {
      kind: "inline",
      capabilityName: plan.capabilityName,
      requestId: "fake-req",
      output: `executed: ${plan.capabilityName}`,
      durationMs: 0,
    };
  }
}

class SlowTarget implements TargetHandler {
  async execute(plan: CapabilityPlan): Promise<CapabilityResult> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      kind: "inline",
      capabilityName: plan.capabilityName,
      requestId: "slow-req",
      output: "done",
      durationMs: 0,
    };
  }
}

class ErrorTarget implements TargetHandler {
  async execute(_plan: CapabilityPlan): Promise<CapabilityResult> {
    throw new Error("handler exploded");
  }
}

describe("CapabilityExecutor", () => {
  let registry: InMemoryCapabilityRegistry;
  let gate: CapabilityPolicyGate;
  let fakeTarget: FakeTarget;
  let targets: Map<ExecutionTarget, TargetHandler>;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    gate = new CapabilityPolicyGate(registry);
    fakeTarget = new FakeTarget();
    targets = new Map([["local-ts", fakeTarget]]);
  });

  it("executes allowed capability through target", async () => {
    registry.register(makeDecl("ls", "allow"));
    const executor = new CapabilityExecutor(targets, gate);

    const result = await executor.execute(makePlan("ls"));
    expect(result.kind).toBe("inline");
    expect(result.output).toBe("executed: ls");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(fakeTarget.lastPlan?.capabilityName).toBe("ls");
  });

  it("denies capability with deny policy", async () => {
    registry.register(makeDecl("danger", "deny"));
    const executor = new CapabilityExecutor(targets, gate);

    const result = await executor.execute(makePlan("danger"));
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("policy-denied");
  });

  it("returns ask error for ask policy", async () => {
    registry.register(makeDecl("write", "ask"));
    const executor = new CapabilityExecutor(targets, gate);

    const result = await executor.execute(makePlan("write"));
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("policy-ask");
  });

  it("returns error when no target handler exists", async () => {
    registry.register(makeDecl("ls", "allow"));
    const emptyTargets = new Map<ExecutionTarget, TargetHandler>();
    const executor = new CapabilityExecutor(emptyTargets, gate);

    const result = await executor.execute(makePlan("ls"));
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("no-target");
  });

  it("catches and wraps handler errors", async () => {
    registry.register(makeDecl("ls", "allow"));
    const errorTargets = new Map<ExecutionTarget, TargetHandler>([
      ["local-ts", new ErrorTarget()],
    ]);
    const executor = new CapabilityExecutor(errorTargets, gate);

    const result = await executor.execute(makePlan("ls"));
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("execution-error");
    expect(result.error?.message).toBe("handler exploded");
  });

  it("enforces timeout", async () => {
    registry.register(makeDecl("ls", "allow"));
    const slowTargets = new Map<ExecutionTarget, TargetHandler>([
      ["local-ts", new SlowTarget()],
    ]);
    const executor = new CapabilityExecutor(slowTargets, gate, {
      timeoutMs: 50,
    });

    const result = await executor.execute(makePlan("ls"));
    expect(result.kind).toBe("timeout");
    expect(result.error?.code).toBe("timeout");
  });
});
