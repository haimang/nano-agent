/**
 * Tests for the B5 `PermissionAuthorizer` producer seam in the
 * CapabilityExecutor.
 *
 * Without an authorizer, an ask-gated capability still surfaces the
 * legacy `policy-ask` error (backward compat). With an authorizer,
 * `allow` lets the handler run and `deny` converts to a
 * `policy-denied` error. The authorizer is the single point where the
 * host wires in `@nano-agent/hooks`'s `HookDispatcher` to emit
 * `PermissionRequest` / `PermissionDenied` events.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CapabilityExecutor } from "../src/executor.js";
import type { TargetHandler } from "../src/executor.js";
import { CapabilityPolicyGate } from "../src/policy.js";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import type { CapabilityPlan, ExecutionTarget } from "../src/types.js";
import type { CapabilityResult } from "../src/result.js";
import type {
  CapabilityPermissionAuthorizer,
  PermissionDecision,
  PermissionRequestContext,
} from "../src/permission.js";

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
  calls = 0;
  async execute(plan: CapabilityPlan): Promise<CapabilityResult> {
    this.calls += 1;
    return {
      kind: "inline",
      capabilityName: plan.capabilityName,
      requestId: "fake",
      output: "ok",
      durationMs: 0,
    };
  }
}

class ScriptedAuthorizer implements CapabilityPermissionAuthorizer {
  calls: PermissionRequestContext[] = [];
  constructor(private verdict: PermissionDecision) {}
  async authorize(ctx: PermissionRequestContext): Promise<PermissionDecision> {
    this.calls.push(ctx);
    return this.verdict;
  }
}

describe("CapabilityExecutor — PermissionAuthorizer seam (B5)", () => {
  let registry: InMemoryCapabilityRegistry;
  let gate: CapabilityPolicyGate;
  let target: FakeTarget;
  let targets: Map<ExecutionTarget, TargetHandler>;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    gate = new CapabilityPolicyGate(registry);
    target = new FakeTarget();
    targets = new Map([["local-ts", target]]);
  });

  it("without an authorizer: ask-gated capability still returns policy-ask (backward compat)", async () => {
    registry.register(makeDecl("write", "ask"));
    const executor = new CapabilityExecutor(targets, gate);
    const result = await executor.execute(makePlan("write"));
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("policy-ask");
    expect(target.calls).toBe(0);
  });

  it("authorizer.verdict='allow' lets the capability execute", async () => {
    registry.register(makeDecl("write", "ask"));
    const authorizer = new ScriptedAuthorizer({ verdict: "allow", handlerCount: 1 });
    const executor = new CapabilityExecutor(targets, gate, {
      permissionAuthorizer: authorizer,
    });
    const result = await executor.execute(makePlan("write"));
    expect(result.kind).toBe("inline");
    expect(target.calls).toBe(1);
    expect(authorizer.calls).toHaveLength(1);
    expect(authorizer.calls[0]?.plan.capabilityName).toBe("write");
    expect(authorizer.calls[0]?.requestId).toMatch(/^req-/);
  });

  it("authorizer.verdict='deny' converts to policy-denied with the handler reason", async () => {
    registry.register(makeDecl("write", "ask"));
    const authorizer = new ScriptedAuthorizer({
      verdict: "deny",
      handlerCount: 1,
      reason: "workspace escape",
      deniedBy: "policy-guard",
    });
    const executor = new CapabilityExecutor(targets, gate, {
      permissionAuthorizer: authorizer,
    });
    const result = await executor.execute(makePlan("write"));
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("policy-denied");
    expect(result.error?.message).toContain("workspace escape");
    expect(target.calls).toBe(0);
  });

  it("authorizer throw is treated as fail-closed deny", async () => {
    registry.register(makeDecl("write", "ask"));
    const authorizer: CapabilityPermissionAuthorizer = {
      authorize: vi.fn(async () => {
        throw new Error("authorizer unavailable");
      }),
    };
    const executor = new CapabilityExecutor(targets, gate, {
      permissionAuthorizer: authorizer,
    });
    const result = await executor.execute(makePlan("write"));
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("policy-denied");
    expect(result.error?.message).toContain("authorizer unavailable");
    expect(target.calls).toBe(0);
  });

  it("static deny still bypasses the authorizer", async () => {
    registry.register(makeDecl("danger", "deny"));
    const authorizer = new ScriptedAuthorizer({ verdict: "allow", handlerCount: 1 });
    const executor = new CapabilityExecutor(targets, gate, {
      permissionAuthorizer: authorizer,
    });
    const result = await executor.execute(makePlan("danger"));
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("policy-denied");
    expect(authorizer.calls).toHaveLength(0);
  });

  describe("executeStream — ask-gated events", () => {
    it("authorizer deny surfaces an error event in the stream", async () => {
      registry.register(makeDecl("write", "ask"));
      const authorizer = new ScriptedAuthorizer({
        verdict: "deny",
        handlerCount: 1,
        reason: "nope",
      });
      const executor = new CapabilityExecutor(targets, gate, {
        permissionAuthorizer: authorizer,
      });
      const events = [];
      for await (const evt of executor.executeStream(makePlan("write"))) {
        events.push(evt);
      }
      const errorEvent = events.find((e) => e.kind === "error");
      expect(errorEvent).toBeDefined();
      expect((errorEvent?.detail as Record<string, unknown>).code).toBe(
        "policy-denied",
      );
    });

    it("authorizer allow lets the stream reach `completed`", async () => {
      registry.register(makeDecl("write", "ask"));
      const authorizer = new ScriptedAuthorizer({ verdict: "allow", handlerCount: 1 });
      const executor = new CapabilityExecutor(targets, gate, {
        permissionAuthorizer: authorizer,
      });
      const kinds: string[] = [];
      for await (const evt of executor.executeStream(makePlan("write"))) {
        kinds.push(evt.kind);
      }
      expect(kinds).toContain("completed");
    });

    it("without authorizer: ask-gated still surfaces policy-ask error event (backward compat)", async () => {
      registry.register(makeDecl("write", "ask"));
      const executor = new CapabilityExecutor(targets, gate);
      const events = [];
      for await (const evt of executor.executeStream(makePlan("write"))) {
        events.push(evt);
      }
      const errorEvent = events.find((e) => e.kind === "error");
      expect((errorEvent?.detail as Record<string, unknown>).code).toBe(
        "policy-ask",
      );
    });
  });
});
