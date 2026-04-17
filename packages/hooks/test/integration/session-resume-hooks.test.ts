import { describe, it, expect, beforeEach } from "vitest";
import { HookDispatcher } from "../../src/dispatcher.js";
import { HookRegistry } from "../../src/registry.js";
import { LocalTsRuntime } from "../../src/runtimes/local-ts.js";
import type { HookRuntime } from "../../src/runtimes/local-ts.js";
import type { HookHandlerConfig, HookRuntimeKind } from "../../src/types.js";
import { snapshotRegistry, restoreRegistry } from "../../src/snapshot.js";

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

describe("Integration: session resume with hooks", () => {
  let localRuntime: LocalTsRuntime;

  beforeEach(() => {
    localRuntime = new LocalTsRuntime();
  });

  function createDispatcher(registry: HookRegistry): HookDispatcher {
    const runtimes = new Map<HookRuntimeKind, HookRuntime>([
      ["local-ts", localRuntime],
    ]);
    return new HookDispatcher(registry, runtimes);
  }

  it("snapshot -> restore -> emit -> verify handlers still work", async () => {
    // ── Phase 1: Set up original registry with handlers ──
    const originalRegistry = new HookRegistry();

    originalRegistry.register(
      makeHandler({
        id: "policy-guard",
        source: "platform-policy",
        event: "PreToolUse",
        description: "Guards tool usage",
      }),
    );

    originalRegistry.register(
      makeHandler({
        id: "session-logger",
        source: "session",
        event: "SessionStart",
        description: "Logs session start",
      }),
    );

    originalRegistry.register(
      makeHandler({
        id: "skill-notify",
        source: "skill",
        event: "PostToolUse",
        description: "Notifies skill",
      }),
    );

    // Register runtime handlers for the original registry
    localRuntime.registerHandler("policy-guard", async () => ({
      action: "continue" as const,
      handlerId: "policy-guard",
      durationMs: 1,
      additionalContext: "Guard passed",
    }));

    localRuntime.registerHandler("session-logger", async () => ({
      action: "continue" as const,
      handlerId: "session-logger",
      durationMs: 1,
      additionalContext: "Session logged",
    }));

    localRuntime.registerHandler("skill-notify", async () => ({
      action: "continue" as const,
      handlerId: "skill-notify",
      durationMs: 1,
      additionalContext: "Skill notified",
    }));

    // ── Phase 2: Verify handlers work before snapshot ──
    const originalDispatcher = createDispatcher(originalRegistry);

    const preSnapshotResult = await originalDispatcher.emit("PreToolUse", { tool: "Bash" });
    expect(preSnapshotResult.outcomes).toHaveLength(1);
    expect(preSnapshotResult.outcomes[0].handlerId).toBe("policy-guard");

    // ── Phase 3: Take snapshot (simulating DO hibernation) ──
    const snapshot = snapshotRegistry(originalRegistry);

    expect(snapshot.handlers).toHaveLength(3);
    expect(snapshot.version).toBeTruthy();
    expect(snapshot.snapshotAt).toBeTruthy();

    // ── Phase 4: Restore from snapshot (simulating DO wake) ──
    const restoredRegistry = restoreRegistry(snapshot);

    // ── Phase 5: Create new dispatcher with restored registry ──
    const restoredDispatcher = createDispatcher(restoredRegistry);

    // ── Phase 6: Verify all events still dispatch correctly ──

    // PreToolUse — should match policy-guard
    const preToolResult = await restoredDispatcher.emit("PreToolUse", { tool: "Read" });
    expect(preToolResult.outcomes).toHaveLength(1);
    expect(preToolResult.outcomes[0].handlerId).toBe("policy-guard");
    expect(preToolResult.outcomes[0].additionalContext).toBe("Guard passed");

    // SessionStart — should match session-logger
    const sessionResult = await restoredDispatcher.emit("SessionStart", {});
    expect(sessionResult.outcomes).toHaveLength(1);
    expect(sessionResult.outcomes[0].handlerId).toBe("session-logger");

    // PostToolUse — should match skill-notify
    const postToolResult = await restoredDispatcher.emit("PostToolUse", {});
    expect(postToolResult.outcomes).toHaveLength(1);
    expect(postToolResult.outcomes[0].handlerId).toBe("skill-notify");
  });

  it("restored registry preserves source priority ordering", async () => {
    const original = new HookRegistry();

    // Register in reverse priority order
    original.register(
      makeHandler({ id: "skill-h", source: "skill", event: "PreToolUse" }),
    );
    original.register(
      makeHandler({ id: "session-h", source: "session", event: "PreToolUse" }),
    );
    original.register(
      makeHandler({ id: "policy-h", source: "platform-policy", event: "PreToolUse" }),
    );

    // All handlers just continue
    for (const id of ["skill-h", "session-h", "policy-h"]) {
      localRuntime.registerHandler(id, async () => ({
        action: "continue" as const,
        handlerId: id,
        durationMs: 1,
      }));
    }

    // Snapshot and restore
    const snapshot = snapshotRegistry(original);
    const restored = restoreRegistry(snapshot);

    // Verify priority ordering is preserved
    const handlers = restored.lookup("PreToolUse");
    expect(handlers.map((h) => h.id)).toEqual([
      "policy-h",
      "session-h",
      "skill-h",
    ]);

    // Verify dispatch works with correct ordering
    const dispatcher = createDispatcher(restored);
    const result = await dispatcher.emit("PreToolUse", {});

    // PreToolUse is blocking, so sequential execution — all should run since all continue
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes[0].handlerId).toBe("policy-h");
    expect(result.outcomes[1].handlerId).toBe("session-h");
    expect(result.outcomes[2].handlerId).toBe("skill-h");
  });

  it("restored registry can receive new registrations after restore", async () => {
    const original = new HookRegistry();
    original.register(
      makeHandler({ id: "original", event: "PreToolUse" }),
    );

    localRuntime.registerHandler("original", async () => ({
      action: "continue" as const,
      handlerId: "original",
      durationMs: 1,
    }));

    // Snapshot and restore
    const snapshot = snapshotRegistry(original);
    const restored = restoreRegistry(snapshot);

    // Add a new handler after restore
    restored.register(
      makeHandler({ id: "new-handler", event: "PreToolUse" }),
    );

    localRuntime.registerHandler("new-handler", async () => ({
      action: "continue" as const,
      handlerId: "new-handler",
      durationMs: 1,
    }));

    // Verify both handlers are found
    expect(restored.lookup("PreToolUse")).toHaveLength(2);

    // Dispatch and verify both run
    const dispatcher = createDispatcher(restored);
    const result = await dispatcher.emit("PreToolUse", {});
    expect(result.outcomes).toHaveLength(2);
  });
});
