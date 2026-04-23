import { describe, it, expect, beforeEach } from "vitest";
import { FakeBashBridge } from "../src/fake-bash/bridge.js";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import { registerMinimalCommands } from "../src/fake-bash/commands.js";
import { planFromBashCommand } from "../src/planner.js";
import { CapabilityExecutor } from "../src/executor.js";
import type { TargetHandler } from "../src/executor.js";
import type { ExecutionTarget, CapabilityPlan } from "../src/types.js";
import type { CapabilityResult } from "../src/result.js";
import { CapabilityPolicyGate } from "../src/policy.js";

class StubTarget implements TargetHandler {
  constructor(private output = "stub-ok") {}
  async execute(plan: CapabilityPlan): Promise<CapabilityResult> {
    return {
      kind: "inline",
      capabilityName: plan.capabilityName,
      requestId: "stub-req",
      output: `${this.output}:${plan.capabilityName}`,
      durationMs: 0,
    };
  }
}

function makeExecutor(registry: InMemoryCapabilityRegistry): CapabilityExecutor {
  const gate = new CapabilityPolicyGate(registry);
  const targets = new Map<ExecutionTarget, TargetHandler>([
    ["local-ts", new StubTarget()],
  ]);
  return new CapabilityExecutor(targets, gate);
}

describe("FakeBashBridge", () => {
  let registry: InMemoryCapabilityRegistry;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    registerMinimalCommands(registry);
  });

  describe("execute with executor", () => {
    it("dispatches a recognized command through the executor", async () => {
      const executor = makeExecutor(registry);
      const bridge = new FakeBashBridge(registry, planFromBashCommand, executor);

      const result = await bridge.execute("ls /workspace");
      expect(result.kind).toBe("inline");
      expect(result.capabilityName).toBe("ls");
      expect(result.output).toBe("stub-ok:ls");
    });

    it("propagates policy-ask for ask-policy commands", async () => {
      const executor = makeExecutor(registry);
      const bridge = new FakeBashBridge(registry, planFromBashCommand, executor);

      const result = await bridge.execute("write foo.txt bar");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("policy-ask");
    });
  });

  describe("execute without executor", () => {
    it("returns no-executor error for a valid plannable command", async () => {
      const bridge = new FakeBashBridge(registry, planFromBashCommand);
      const result = await bridge.execute("ls /workspace");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("no-executor");
      expect(result.capabilityName).toBe("ls");
    });

    it("never fabricates a success result", async () => {
      const bridge = new FakeBashBridge(registry, planFromBashCommand);
      const result = await bridge.execute("pwd");
      expect(result.kind).toBe("error");
      expect(result.kind).not.toBe("inline");
    });
  });

  describe("execute — rejection paths", () => {
    let bridge: FakeBashBridge;

    beforeEach(() => {
      bridge = new FakeBashBridge(
        registry,
        planFromBashCommand,
        makeExecutor(registry),
      );
    });

    it("rejects an unsupported command", async () => {
      const result = await bridge.execute("sudo rm -rf /");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("unsupported-command");
      expect(result.error?.message).toContain("sudo");
    });

    it("rejects an unrecognized command", async () => {
      const result = await bridge.execute("nonexistent-tool foo");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("unknown-command");
    });

    it("rejects an empty command", async () => {
      const result = await bridge.execute("");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("empty-command");
    });

    it("rejects docker (unsupported)", async () => {
      const result = await bridge.execute("docker run hello");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("unsupported-command");
    });

    it("rejects npm (unsupported)", async () => {
      const result = await bridge.execute("npm install foo");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("unsupported-command");
    });

    it("blocks tar with oom-risk-blocked code", async () => {
      const result = await bridge.execute("tar -xvf archive.tar");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("oom-risk-blocked");
      expect(result.error?.message).toContain("tar");
      expect(result.error?.message).toContain("isolate memory");
    });

    it("blocks gzip with oom-risk-blocked code", async () => {
      const result = await bridge.execute("gzip big.log");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("oom-risk-blocked");
    });
  });

  describe("plan (plan-only mode)", () => {
    let bridge: FakeBashBridge;

    beforeEach(() => {
      bridge = new FakeBashBridge(registry, planFromBashCommand);
    });

    it("returns a CapabilityPlan for a recognized command", () => {
      const plan = bridge.plan("ls /workspace");
      expect(plan).not.toBeNull();
      expect(plan!.capabilityName).toBe("ls");
      expect(plan!.input).toEqual({ path: "/workspace" });
      expect(plan!.source).toBe("bash-command");
      expect(plan!.rawCommand).toBe("ls /workspace");
    });

    it("returns null for an unsupported command", () => {
      expect(bridge.plan("sudo anything")).toBeNull();
    });

    it("returns null for an oom-risk command", () => {
      expect(bridge.plan("tar -xvf x.tar")).toBeNull();
    });

    it("returns null for an unknown command", () => {
      expect(bridge.plan("nonexistent foo")).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(bridge.plan("")).toBeNull();
    });
  });

  describe("isSupported", () => {
    let bridge: FakeBashBridge;

    beforeEach(() => {
      bridge = new FakeBashBridge(registry, planFromBashCommand);
    });

    it("returns true for registered commands", () => {
      expect(bridge.isSupported("ls")).toBe(true);
      expect(bridge.isSupported("cat")).toBe(true);
      expect(bridge.isSupported("pwd")).toBe(true);
    });

    it("returns false for unsupported commands", () => {
      expect(bridge.isSupported("sudo")).toBe(false);
      expect(bridge.isSupported("docker")).toBe(false);
    });

    it("returns false for OOM-risk commands", () => {
      expect(bridge.isSupported("tar")).toBe(false);
      expect(bridge.isSupported("gzip")).toBe(false);
    });

    it("returns false for unknown commands", () => {
      expect(bridge.isSupported("nonexistent")).toBe(false);
    });
  });

  describe("B3-R1 — bash-narrow violation surfaces (no raw throws)", () => {
    it("plan() returns null instead of throwing on bash-narrow violation", () => {
      const bridge = new FakeBashBridge(registry, planFromBashCommand);
      // `head -n 5 file.txt` violates B3 file/path-first narrow rule
      expect(() => bridge.plan("head -n 5 file.txt")).not.toThrow();
      expect(bridge.plan("head -n 5 file.txt")).toBeNull();
      // `curl -X POST …` violates Q17 narrow rule
      expect(() => bridge.plan("curl -X POST https://example.com")).not.toThrow();
      expect(bridge.plan("curl -X POST https://example.com")).toBeNull();
    });

    it("execute() returns structured error result instead of throwing", async () => {
      const executor = makeExecutor(registry);
      const bridge = new FakeBashBridge(registry, planFromBashCommand, executor);
      const result = await bridge.execute("head -n 5 file.txt");
      expect(result.kind).toBe("error");
      expect(result.error?.code).toBe("bash-narrow-rejected");
      // Marker from text-processing-bash-narrow contract
      expect(result.error?.message).toContain(
        "text-processing-bash-narrow-use-structured",
      );
    });

    it("execute() bash-narrow error result preserves capability name", async () => {
      const executor = makeExecutor(registry);
      const bridge = new FakeBashBridge(registry, planFromBashCommand, executor);
      const result = await bridge.execute("curl -X POST https://example.com");
      expect(result.kind).toBe("error");
      expect(result.capabilityName).toBe("curl");
      expect(result.error?.code).toBe("bash-narrow-rejected");
    });
  });

  describe("listCommands", () => {
    it("lists all 21 registered command names (B3: 12 minimal + 9 text-processing)", () => {
      const bridge = new FakeBashBridge(registry, planFromBashCommand);
      const commands = bridge.listCommands();
      // 12 minimal pack
      expect(commands).toContain("ls");
      expect(commands).toContain("cat");
      expect(commands).toContain("pwd");
      expect(commands).toContain("write");
      expect(commands).toContain("rg");
      expect(commands).toContain("curl");
      expect(commands).toContain("ts-exec");
      expect(commands).toContain("git");
      // 9 text-processing wave (B3)
      expect(commands).toContain("wc");
      expect(commands).toContain("head");
      expect(commands).toContain("tail");
      expect(commands).toContain("jq");
      expect(commands).toContain("sed");
      expect(commands).toContain("awk");
      expect(commands).toContain("sort");
      expect(commands).toContain("uniq");
      expect(commands).toContain("diff");
      expect(commands.length).toBe(21);
    });
  });
});
