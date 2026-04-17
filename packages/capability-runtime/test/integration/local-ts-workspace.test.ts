/**
 * Integration: LocalTsTarget + in-memory filesystem handlers
 *
 * Exercises the full registry + planner + policy + executor + local-ts
 * target pipeline with a simple in-memory "filesystem" stub. The stub
 * is deliberately lightweight — the goal is to verify that the wiring
 * is correct, not to test a real filesystem.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCapabilityRegistry } from "../../src/registry.js";
import { registerMinimalCommands } from "../../src/fake-bash/commands.js";
import { CapabilityPolicyGate } from "../../src/policy.js";
import { CapabilityExecutor } from "../../src/executor.js";
import { LocalTsTarget } from "../../src/targets/local-ts.js";
import { planFromBashCommand } from "../../src/planner.js";
import type { ExecutionTarget, CapabilityDeclaration } from "../../src/types.js";
import type { TargetHandler } from "../../src/executor.js";
import type { LocalCapabilityHandler } from "../../src/targets/local-ts.js";

/**
 * Minimal in-memory filesystem handlers. This is intentionally NOT the
 * full `createFilesystemHandlers` factory — we want an isolated, easy
 * to reason about stub so we don't drag in workspace-package details.
 */
function createMemoryFsHandlers(): {
  files: Map<string, string>;
  handlers: Map<string, LocalCapabilityHandler>;
} {
  const files = new Map<string, string>();

  const handlers = new Map<string, LocalCapabilityHandler>();

  handlers.set("pwd", async () => ({ output: "/memory-workspace" }));

  handlers.set("ls", async (input) => {
    const { path = "." } = (input ?? {}) as { path?: string };
    const prefix = path === "." ? "" : path.replace(/\/$/, "") + "/";
    const entries = Array.from(files.keys())
      .filter((f) => (prefix === "" ? true : f.startsWith(prefix)))
      .sort();
    return { output: entries.join("\n") };
  });

  handlers.set("cat", async (input) => {
    const { path = "" } = (input ?? {}) as { path?: string };
    if (!files.has(path)) {
      throw new Error(`cat: ${path}: No such file`);
    }
    return { output: files.get(path)! };
  });

  handlers.set("write", async (input) => {
    const { path = "", content = "" } = (input ?? {}) as {
      path?: string;
      content?: string;
    };
    if (!path) throw new Error("write: no path");
    files.set(path, content);
    return { output: `wrote ${content.length} bytes to ${path}` };
  });

  return { files, handlers };
}

function allowAll(registry: InMemoryCapabilityRegistry): void {
  // The default minimal command set has some "ask" policies. For this
  // integration test we override those to "allow" so we can exercise
  // the happy path.
  for (const name of ["write", "mkdir", "rm", "mv", "cp", "curl", "ts-exec"]) {
    const existing = registry.get(name);
    if (existing) {
      registry.remove(name);
      const relaxed: CapabilityDeclaration = { ...existing, policy: "allow" };
      registry.register(relaxed);
    }
  }
}

describe("integration: LocalTsTarget + memory workspace", () => {
  let registry: InMemoryCapabilityRegistry;
  let target: LocalTsTarget;
  let executor: CapabilityExecutor;
  let fs: ReturnType<typeof createMemoryFsHandlers>;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    registerMinimalCommands(registry);
    allowAll(registry);

    target = new LocalTsTarget();
    fs = createMemoryFsHandlers();
    for (const [name, handler] of fs.handlers) {
      target.registerHandler(name, handler);
    }

    const gate = new CapabilityPolicyGate(registry);
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["local-ts", target],
    ]);
    executor = new CapabilityExecutor(targets, gate);
  });

  it("executes pwd via plan -> executor -> target", async () => {
    const plan = planFromBashCommand("pwd", registry);
    expect(plan).not.toBeNull();
    const result = await executor.execute(plan!);
    expect(result.kind).toBe("inline");
    expect(result.output).toBe("/memory-workspace");
  });

  it("executes ls against an empty filesystem", async () => {
    const plan = planFromBashCommand("ls .", registry);
    const result = await executor.execute(plan!);
    expect(result.kind).toBe("inline");
    expect(result.output).toBe("");
  });

  it("supports a write + cat roundtrip", async () => {
    const writePlan = planFromBashCommand("write hello.txt world", registry);
    const writeResult = await executor.execute(writePlan!);
    expect(writeResult.kind).toBe("inline");
    expect(writeResult.output).toContain("wrote");
    expect(fs.files.get("hello.txt")).toBe("world");

    const catPlan = planFromBashCommand("cat hello.txt", registry);
    const catResult = await executor.execute(catPlan!);
    expect(catResult.kind).toBe("inline");
    expect(catResult.output).toBe("world");
  });

  it("ls reflects writes", async () => {
    await executor.execute(planFromBashCommand("write a.txt 1", registry)!);
    await executor.execute(planFromBashCommand("write b.txt 2", registry)!);
    const listing = await executor.execute(planFromBashCommand("ls .", registry)!);
    expect(listing.kind).toBe("inline");
    expect(listing.output).toBe("a.txt\nb.txt");
  });

  it("returns handler-error when cat targets a missing file", async () => {
    const plan = planFromBashCommand("cat missing.txt", registry);
    const result = await executor.execute(plan!);
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("handler-error");
    expect(result.error?.message).toContain("missing.txt");
  });
});
