/**
 * Integration — service-binding runtime timeout via a fake transport.
 *
 * The real `ServiceBindingRuntime` stub is not wired up yet (that will
 * happen in session-do-runtime), but we can stand in a fake runtime
 * that models a remote worker and verify that a slow or stuck worker
 * is correctly:
 *   - killed by the dispatcher's timeout guard,
 *   - turned into a `continue` outcome with `diagnostics` (never an
 *     uncaught exception reaching the main loop),
 *   - round-tripped through the core-mapping builder so the wire body
 *     matches `@nano-agent/nacp-core`'s `hook.emit` schema.
 */

import { describe, it, expect } from "vitest";
import { HookEmitBodySchema } from "../../../nacp-core/src/messages/hook.js";
import { HookDispatcher } from "../../src/dispatcher.js";
import { HookRegistry } from "../../src/registry.js";
import type { HookRuntime } from "../../src/runtimes/local-ts.js";
import type { HookHandlerConfig, HookRuntimeKind } from "../../src/types.js";
import type { HookOutcome } from "../../src/outcome.js";
import { buildHookEmitBody, parseHookOutcomeBody } from "../../src/core-mapping.js";

/** A fake "remote worker" that returns after a configurable delay. */
class FakeServiceBindingRuntime implements HookRuntime {
  lastEmitBody: unknown = undefined;

  constructor(
    private readonly responder: (
      handler: HookHandlerConfig,
      payload: unknown,
    ) => Promise<{ body: unknown; delayMs: number }>,
  ) {}

  async execute(
    handler: HookHandlerConfig,
    payload: unknown,
    _context: unknown,
  ): Promise<HookOutcome> {
    const emitBody = buildHookEmitBody(handler.event, payload);
    this.lastEmitBody = emitBody;

    // Schema check before "sending".
    const parsed = HookEmitBodySchema.safeParse(emitBody);
    if (!parsed.success) {
      throw new Error(`fake transport: hook.emit body rejected by schema`);
    }

    const { body, delayMs } = await this.responder(handler, payload);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return parseHookOutcomeBody(body, { handlerId: handler.id, durationMs: delayMs });
  }
}

describe("Integration: service-binding runtime timeout", () => {
  it("a hung remote worker is killed by the dispatcher timeout and returns a diagnostics outcome", async () => {
    const registry = new HookRegistry();
    registry.register({
      id: "slow-worker",
      source: "platform-policy",
      event: "PreToolUse",
      runtime: "service-binding",
      timeoutMs: 50,
    });

    const fakeRuntime = new FakeServiceBindingRuntime(async () => ({
      body: { ok: true },
      // Delay longer than the handler timeout to force timeout path.
      delayMs: 500,
    }));

    const dispatcher = new HookDispatcher(
      registry,
      new Map<HookRuntimeKind, HookRuntime>([["service-binding", fakeRuntime]]),
    );

    const outcome = await dispatcher.emit(
      "PreToolUse",
      { tool_name: "Bash", tool_input: "ls" },
      { toolName: "Bash" },
    );

    // The dispatcher must NOT throw — it must convert the timeout into
    // a continue + diagnostics outcome.
    expect(outcome.finalAction).toBe("continue");
    expect(outcome.blocked).toBe(false);
    expect(outcome.outcomes).toHaveLength(1);
    expect(outcome.outcomes[0].diagnostics?.error).toMatch(/timed out/i);

    // The hook.emit body must match nacp-core's schema.
    expect(HookEmitBodySchema.safeParse(fakeRuntime.lastEmitBody).success).toBe(true);
  });

  it("a responsive remote worker produces a normal outcome through the same path", async () => {
    const registry = new HookRegistry();
    registry.register({
      id: "fast-worker",
      source: "session",
      event: "PreToolUse",
      runtime: "service-binding",
      timeoutMs: 1000,
    });

    const fakeRuntime = new FakeServiceBindingRuntime(async () => ({
      body: { ok: true, additional_context: "allowed" },
      delayMs: 5,
    }));

    const dispatcher = new HookDispatcher(
      registry,
      new Map<HookRuntimeKind, HookRuntime>([["service-binding", fakeRuntime]]),
    );

    const outcome = await dispatcher.emit("PreToolUse", { tool_name: "Read" });
    expect(outcome.finalAction).toBe("continue");
    expect(outcome.mergedContext).toBe("allowed");
  });
});
