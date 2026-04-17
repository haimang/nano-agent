/**
 * Integration — PreCompact blocking handler + audit + broadcast.
 *
 * Verifies the full compact-guard lifecycle:
 *   - a platform-policy handler on PreCompact can block compaction,
 *   - short-circuit applies (subsequent handlers do not run),
 *   - the resulting broadcast body parses under the real
 *     `SessionStreamEventBodySchema`,
 *   - the audit body parses under the real `AuditRecordBodySchema` and
 *     identifies the blocking handler,
 *   - a non-blocking PreCompact (no matching handler) is reported as
 *     continue/unblocked.
 */

import { describe, it, expect } from "vitest";
import { AuditRecordBodySchema } from "../../../nacp-core/src/messages/system.js";
import { SessionStreamEventBodySchema } from "../../../nacp-session/src/stream-event.js";
import { HookDispatcher } from "../../src/dispatcher.js";
import { HookRegistry } from "../../src/registry.js";
import { LocalTsRuntime } from "../../src/runtimes/local-ts.js";
import type { HookRuntime } from "../../src/runtimes/local-ts.js";
import type { HookRuntimeKind } from "../../src/types.js";
import { buildHookAuditRecord } from "../../src/audit.js";
import { hookEventToSessionBroadcast } from "../../src/session-mapping.js";

describe("Integration: PreCompact guard", () => {
  it("a PreCompact blocking handler halts compact + produces schema-valid audit + broadcast", async () => {
    const registry = new HookRegistry();
    const runtime = new LocalTsRuntime();

    registry.register({
      id: "token-budget-guard",
      source: "platform-policy",
      event: "PreCompact",
      runtime: "local-ts",
    });
    registry.register({
      id: "compact-logger",
      source: "session",
      event: "PreCompact",
      runtime: "local-ts",
    });

    runtime.registerHandler("token-budget-guard", async () => ({
      action: "block" as const,
      handlerId: "token-budget-guard",
      durationMs: 2,
      additionalContext: "compact blocked: token budget still has 40% headroom",
    }));
    let loggerRan = false;
    runtime.registerHandler("compact-logger", async () => {
      loggerRan = true;
      return { action: "continue" as const, handlerId: "compact-logger", durationMs: 1 };
    });

    const dispatcher = new HookDispatcher(
      registry,
      new Map<HookRuntimeKind, HookRuntime>([["local-ts", runtime]]),
    );

    const start = Date.now();
    const outcome = await dispatcher.emit("PreCompact", {
      reason: "context-full",
      historyRef: "ref-42",
    });
    const duration = Date.now() - start;

    // Outcome assertions.
    expect(outcome.finalAction).toBe("block");
    expect(outcome.blocked).toBe(true);
    expect(outcome.blockReason).toMatch(/compact blocked/);
    expect(loggerRan).toBe(false); // short-circuit on block
    expect(outcome.outcomes).toHaveLength(1);

    // Audit body assertions.
    const audit = buildHookAuditRecord("PreCompact", outcome, duration);
    expect(audit.event_kind).toBe("hook.outcome");
    expect(audit.detail?.hookEvent).toBe("PreCompact");
    expect(audit.detail?.blocked).toBe(true);
    expect(audit.detail?.blockedBy).toBe("token-budget-guard");
    expect(AuditRecordBodySchema.safeParse(audit).success).toBe(true);

    // Broadcast body assertions.
    const broadcast = hookEventToSessionBroadcast(
      "PreCompact",
      { reason: "context-full", historyRef: "ref-42" },
      outcome,
    );
    expect(broadcast.kind).toBe("hook.broadcast");
    expect(broadcast.event_name).toBe("PreCompact");
    expect(SessionStreamEventBodySchema.safeParse(broadcast).success).toBe(true);
  });

  it("no matching PreCompact handler → compact proceeds (continue / not blocked)", async () => {
    const registry = new HookRegistry();
    const runtime = new LocalTsRuntime();
    const dispatcher = new HookDispatcher(
      registry,
      new Map<HookRuntimeKind, HookRuntime>([["local-ts", runtime]]),
    );

    const outcome = await dispatcher.emit("PreCompact", { reason: "idle" });
    expect(outcome.finalAction).toBe("continue");
    expect(outcome.blocked).toBe(false);
    expect(outcome.outcomes).toHaveLength(0);
  });

  it("PreCompact observer-only handler (diagnostics only) does not block compaction", async () => {
    const registry = new HookRegistry();
    const runtime = new LocalTsRuntime();

    registry.register({
      id: "observer",
      source: "session",
      event: "PreCompact",
      runtime: "local-ts",
    });
    runtime.registerHandler("observer", async () => ({
      action: "continue" as const,
      handlerId: "observer",
      durationMs: 1,
      diagnostics: { notable: "budget at 80%" },
    }));

    const dispatcher = new HookDispatcher(
      registry,
      new Map<HookRuntimeKind, HookRuntime>([["local-ts", runtime]]),
    );

    const outcome = await dispatcher.emit("PreCompact", { reason: "idle" });
    expect(outcome.blocked).toBe(false);
    expect(outcome.mergedDiagnostics).toEqual({ notable: "budget at 80%" });
  });
});
