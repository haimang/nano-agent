import { describe, it, expect, beforeEach } from "vitest";
import { HookDispatcher } from "../../../src/hooks/dispatcher.js";
import { HookRegistry } from "../../../src/hooks/registry.js";
import { LocalTsRuntime } from "../../../src/hooks/runtimes/local-ts.js";
import type { HookRuntime } from "../../../src/hooks/runtimes/local-ts.js";
import type { HookHandlerConfig, HookRuntimeKind } from "../../../src/hooks/types.js";
import { buildHookAuditRecord } from "../../../src/hooks/audit.js";

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

describe("Integration: PreToolUse blocking scenario", () => {
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

  it("registers a blocking handler, emits PreToolUse, and verifies block outcome", async () => {
    // Step 1: Register a platform-policy handler that blocks dangerous tools
    const blockHandler = makeHandler({
      id: "dangerous-tool-blocker",
      source: "platform-policy",
      event: "PreToolUse",
      matcher: { type: "toolName", value: "Bash" },
    });
    registry.register(blockHandler);

    localRuntime.registerHandler("dangerous-tool-blocker", async (payload) => {
      const p = payload as Record<string, unknown>;
      return {
        action: "block" as const,
        handlerId: "dangerous-tool-blocker",
        durationMs: 2,
        additionalContext: `Blocked dangerous tool: ${p.tool_name}`,
      };
    });

    // Step 2: Register a session handler that would normally continue
    const logHandler = makeHandler({
      id: "tool-logger",
      source: "session",
      event: "PreToolUse",
    });
    registry.register(logHandler);

    let loggerCalled = false;
    localRuntime.registerHandler("tool-logger", async () => {
      loggerCalled = true;
      return {
        action: "continue" as const,
        handlerId: "tool-logger",
        durationMs: 1,
      };
    });

    // Step 3: Emit PreToolUse for "Bash" tool
    const startTime = Date.now();
    const outcome = await dispatcher.emit(
      "PreToolUse",
      { tool_name: "Bash", tool_input: "rm -rf /" },
      { toolName: "Bash" },
    );
    const durationMs = Date.now() - startTime;

    // Step 4: Verify the outcome is blocked
    expect(outcome.blocked).toBe(true);
    expect(outcome.finalAction).toBe("block");
    expect(outcome.blockReason).toContain("Blocked dangerous tool");

    // Step 5: The logger should NOT have run (short-circuit on block)
    expect(loggerCalled).toBe(false);

    // Step 6: Only the blocking handler's outcome should be present
    expect(outcome.outcomes).toHaveLength(1);
    expect(outcome.outcomes[0].handlerId).toBe("dangerous-tool-blocker");

    // Step 7: Build an audit.record body and verify
    const audit = buildHookAuditRecord("PreToolUse", outcome, durationMs);
    expect(audit.event_kind).toBe("hook.outcome");
    expect(audit.detail?.hookEvent).toBe("PreToolUse");
    expect(audit.detail?.blockedBy).toBe("dangerous-tool-blocker");
    expect(audit.detail?.handlerCount).toBe(1);
  });

  it("allows tool use when no blocking handler matches", async () => {
    // Register a blocker for "Read" tool only
    const blockHandler = makeHandler({
      id: "read-blocker",
      source: "platform-policy",
      event: "PreToolUse",
      matcher: { type: "toolName", value: "Read" },
    });
    registry.register(blockHandler);

    localRuntime.registerHandler("read-blocker", async () => ({
      action: "block" as const,
      handlerId: "read-blocker",
      durationMs: 1,
    }));

    // Register a catch-all logger
    const logHandler = makeHandler({
      id: "logger",
      source: "session",
      event: "PreToolUse",
    });
    registry.register(logHandler);

    localRuntime.registerHandler("logger", async () => ({
      action: "continue" as const,
      handlerId: "logger",
      durationMs: 1,
      additionalContext: "Tool use logged",
    }));

    // Emit for "Bash" tool — the Read blocker should not match
    const outcome = await dispatcher.emit(
      "PreToolUse",
      { tool_name: "Bash" },
      { toolName: "Bash" },
    );

    // Should not be blocked
    expect(outcome.blocked).toBe(false);
    expect(outcome.finalAction).toBe("continue");
    expect(outcome.outcomes).toHaveLength(1);
    expect(outcome.outcomes[0].handlerId).toBe("logger");
  });

  it("block action is demoted to continue for non-blocking events", async () => {
    // PostToolUse is NOT blocking and does not allow "block" action
    const handler = makeHandler({
      id: "post-handler",
      event: "PostToolUse",
    });
    registry.register(handler);

    localRuntime.registerHandler("post-handler", async () => ({
      action: "block" as const,
      handlerId: "post-handler",
      durationMs: 1,
    }));

    const outcome = await dispatcher.emit("PostToolUse", {});

    // Block should be demoted since PostToolUse doesn't allow block
    expect(outcome.finalAction).toBe("continue");
    expect(outcome.blocked).toBe(false);
  });
});
