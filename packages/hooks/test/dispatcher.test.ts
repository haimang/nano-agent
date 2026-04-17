import { describe, it, expect, beforeEach } from "vitest";
import { HookDispatcher } from "../src/dispatcher.js";
import { HookRegistry } from "../src/registry.js";
import { LocalTsRuntime } from "../src/runtimes/local-ts.js";
import type { HookRuntime } from "../src/runtimes/local-ts.js";
import type { HookHandlerConfig, HookRuntimeKind } from "../src/types.js";
import type { HookOutcome } from "../src/outcome.js";

function makeHandler(
  overrides: Partial<HookHandlerConfig> & { id: string },
): HookHandlerConfig {
  return {
    source: "session",
    event: "PreToolUse",
    runtime: "local-ts",
    ...overrides,
  };
}

describe("HookDispatcher", () => {
  let registry: HookRegistry;
  let localRuntime: LocalTsRuntime;
  let runtimes: Map<HookRuntimeKind, HookRuntime>;
  let dispatcher: HookDispatcher;

  beforeEach(() => {
    registry = new HookRegistry();
    localRuntime = new LocalTsRuntime();
    runtimes = new Map<HookRuntimeKind, HookRuntime>([
      ["local-ts", localRuntime],
    ]);
    dispatcher = new HookDispatcher(registry, runtimes);
  });

  // ── basic emit ─────────────────────────────────────────────────────

  it("emits an event and returns aggregated outcome", async () => {
    const handler = makeHandler({ id: "h1" });
    registry.register(handler);
    localRuntime.registerHandler("h1", async () => ({
      action: "continue",
      handlerId: "h1",
      durationMs: 1,
    }));

    const result = await dispatcher.emit("PreToolUse", { tool: "Bash" });
    expect(result.finalAction).toBe("continue");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].handlerId).toBe("h1");
  });

  // ── no handlers registered ────────────────────────────────────────

  it("returns empty aggregated outcome when no handlers match", async () => {
    const result = await dispatcher.emit("SessionStart", {});
    expect(result.finalAction).toBe("continue");
    expect(result.outcomes).toHaveLength(0);
    expect(result.blocked).toBe(false);
  });

  // ── blocking event with block outcome ─────────────────────────────

  it("blocking event short-circuits on block action", async () => {
    const h1 = makeHandler({ id: "blocker", source: "platform-policy" });
    const h2 = makeHandler({ id: "after-blocker", source: "session" });
    registry.register(h1);
    registry.register(h2);

    localRuntime.registerHandler("blocker", async () => ({
      action: "block",
      handlerId: "blocker",
      durationMs: 1,
      additionalContext: "Blocked by policy",
    }));
    localRuntime.registerHandler("after-blocker", async () => ({
      action: "continue",
      handlerId: "after-blocker",
      durationMs: 1,
    }));

    const result = await dispatcher.emit("PreToolUse", {});
    expect(result.blocked).toBe(true);
    expect(result.finalAction).toBe("block");
    // The second handler should NOT have been executed (short-circuit)
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].handlerId).toBe("blocker");
  });

  // ── non-blocking event runs all handlers in parallel ──────────────

  it("non-blocking event runs all handlers", async () => {
    const h1 = makeHandler({ id: "nb1", event: "SessionStart" });
    const h2 = makeHandler({ id: "nb2", event: "SessionStart" });
    registry.register(h1);
    registry.register(h2);

    localRuntime.registerHandler("nb1", async () => ({
      action: "continue",
      handlerId: "nb1",
      durationMs: 1,
      additionalContext: "ctx from nb1",
    }));
    localRuntime.registerHandler("nb2", async () => ({
      action: "continue",
      handlerId: "nb2",
      durationMs: 1,
      additionalContext: "ctx from nb2",
    }));

    const result = await dispatcher.emit("SessionStart", {});
    expect(result.finalAction).toBe("continue");
    expect(result.outcomes).toHaveLength(2);
  });

  // ── matcher filtering ─────────────────────────────────────────────

  it("filters handlers by matcher", async () => {
    const matched = makeHandler({
      id: "match",
      matcher: { type: "toolName", value: "Bash" },
    });
    const unmatched = makeHandler({
      id: "nomatch",
      matcher: { type: "toolName", value: "Read" },
    });
    registry.register(matched);
    registry.register(unmatched);

    localRuntime.registerHandler("match", async () => ({
      action: "continue",
      handlerId: "match",
      durationMs: 1,
    }));
    localRuntime.registerHandler("nomatch", async () => ({
      action: "continue",
      handlerId: "nomatch",
      durationMs: 1,
    }));

    const result = await dispatcher.emit("PreToolUse", {}, { toolName: "Bash" });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].handlerId).toBe("match");
  });

  // ── handler error is caught and returned as continue with diagnostics ──

  it("catches handler errors and returns continue with error diagnostics", async () => {
    const handler = makeHandler({ id: "err" });
    registry.register(handler);
    localRuntime.registerHandler("err", async () => {
      throw new Error("handler broke");
    });

    const result = await dispatcher.emit("PreToolUse", {});
    expect(result.finalAction).toBe("continue");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].diagnostics).toEqual({
      error: "handler broke",
    });
  });

  // ── multiple handlers aggregate outcomes ──────────────────────────

  // ── recursion depth guard is wired into emit() ───────────────────

  it("rejects emit when the caller-supplied depth is already above maxDepth", async () => {
    const handler = makeHandler({ id: "h1" });
    registry.register(handler);
    localRuntime.registerHandler("h1", async () => ({
      action: "continue",
      handlerId: "h1",
      durationMs: 1,
    }));

    const depthLimitedDispatcher = new HookDispatcher(registry, runtimes, {
      maxDepth: 2,
    });

    await expect(
      depthLimitedDispatcher.emit("PreToolUse", {}, { depth: 3 }),
    ).rejects.toThrow(/exceeds maximum of 2/);
  });

  it("permits emits at or below maxDepth", async () => {
    const handler = makeHandler({ id: "h1" });
    registry.register(handler);
    localRuntime.registerHandler("h1", async () => ({
      action: "continue",
      handlerId: "h1",
      durationMs: 1,
    }));

    const depthLimitedDispatcher = new HookDispatcher(registry, runtimes, {
      maxDepth: 2,
    });

    const result = await depthLimitedDispatcher.emit("PreToolUse", {}, { depth: 2 });
    expect(result.finalAction).toBe("continue");
    expect(result.outcomes).toHaveLength(1);
  });

  it("propagates AbortSignal through withTimeout: aborted handler becomes continue+diagnostics", async () => {
    const handler = makeHandler({ id: "slow", event: "PreToolUse" });
    registry.register(handler);

    localRuntime.registerHandler("slow", () => new Promise(() => {}));

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    const result = await dispatcher.emit("PreToolUse", {}, { abortSignal: controller.signal });
    expect(result.finalAction).toBe("continue");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].diagnostics?.error).toMatch(/aborted/i);
  });

  it("aggregates outcomes from multiple handlers", async () => {
    const h1 = makeHandler({ id: "a1", event: "PostToolUse" });
    const h2 = makeHandler({ id: "a2", event: "PostToolUse" });
    registry.register(h1);
    registry.register(h2);

    localRuntime.registerHandler("a1", async () => ({
      action: "continue",
      handlerId: "a1",
      durationMs: 1,
      additionalContext: "info-a",
      diagnostics: { key1: "val1" },
    }));
    localRuntime.registerHandler("a2", async () => ({
      action: "continue",
      handlerId: "a2",
      durationMs: 2,
      additionalContext: "info-b",
      diagnostics: { key2: "val2" },
    }));

    const result = await dispatcher.emit("PostToolUse", {});
    expect(result.mergedContext).toBe("info-a\ninfo-b");
    expect(result.mergedDiagnostics).toEqual({ key1: "val1", key2: "val2" });
  });
});
