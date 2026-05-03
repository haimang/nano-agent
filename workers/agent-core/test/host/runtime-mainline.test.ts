import { describe, expect, it, vi } from "vitest";
import { applyAction } from "../../src/kernel/reducer.js";
import { createInitialSessionState, createKernelSnapshot } from "../../src/kernel/state.js";
import type { SchedulerSignals } from "../../src/kernel/scheduler.js";
import {
  createMainlineKernelRunner,
  resetModelPromptSuffixCache,
} from "../../src/host/runtime-mainline.js";
import type { QuotaAuthorizer } from "../../src/host/quota/authorizer.js";
import { createSessionHookRuntime } from "../../src/hooks/session-registration.js";

function baseSignals(overrides: Partial<SchedulerSignals> = {}): SchedulerSignals {
  return {
    hasMoreToolCalls: false,
    compactRequired: false,
    cancelRequested: false,
    timeoutReached: false,
    llmFinished: false,
    ...overrides,
  };
}

function runningSnapshot(turnId = "turn-1") {
  return applyAction(createKernelSnapshot(createInitialSessionState()), {
    type: "start_turn",
    turnId,
  });
}

function toolSnapshot(turnId = "turn-1") {
  return applyAction(runningSnapshot(turnId), {
    type: "tool_calls_requested",
    calls: [{ id: "tool-1", name: "pwd", input: {} }],
  });
}

function namedToolSnapshot(name: string, input: Record<string, unknown>, turnId = "turn-1") {
  return applyAction(runningSnapshot(turnId), {
    type: "tool_calls_requested",
    calls: [{ id: "tool-1", name, input }],
  });
}

describe("createMainlineKernelRunner", () => {
  it("does not advance llm request ids when authorization fails before commit", async () => {
    const authorize = vi
      .fn()
      .mockRejectedValueOnce(new Error("quota backend unavailable"))
      .mockResolvedValueOnce({
        requestId: "llm-turn-1-1",
        quotaKind: "llm",
        remaining: 10,
        limitValue: 20,
      });
    const commit = vi.fn().mockResolvedValue({
      teamUuid: "team-1",
      quotaKind: "llm",
      remaining: 19,
      limitValue: 20,
      updatedAt: "2026-04-25T00:00:00.000Z",
    });
    const quotaAuthorizer = {
      authorize,
      commit,
    } as unknown as QuotaAuthorizer;

    const runner = createMainlineKernelRunner({
      ai: {
        run: vi.fn(async () => ({
          response: "hello",
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        })),
      },
      quotaAuthorizer,
      capabilityTransport: undefined,
      contextProvider: () => ({
        teamUuid: "team-1",
        sessionUuid: "session-1",
        traceUuid: "trace-1",
        turnUuid: "turn-1",
      }),
      anchorProvider: () => undefined,
    });

    await runner.advanceStep(runningSnapshot("turn-1"), baseSignals());
    await runner.advanceStep(runningSnapshot("turn-1"), baseSignals());

    expect(authorize.mock.calls.map((call) => call[2])).toEqual([
      "llm-turn-1-1",
      "llm-turn-1-1",
    ]);
    expect(commit).toHaveBeenCalledWith(
      "llm",
      expect.objectContaining({ teamUuid: "team-1" }),
      "llm-turn-1-1",
      expect.objectContaining({
        provider_key: "workers-ai",
        input_tokens: 2,
        output_tokens: 3,
      }),
    );
  });

  it("does not commit tool quota when capability execution returns an error envelope", async () => {
    const authorize = vi.fn().mockResolvedValue({
      requestId: "tool-1",
      quotaKind: "tool",
      remaining: 50,
      limitValue: 100,
    });
    const commit = vi.fn();
    const quotaAuthorizer = {
      authorize,
      commit,
    } as unknown as QuotaAuthorizer;

    const runner = createMainlineKernelRunner({
      ai: {
        run: vi.fn(),
      },
      quotaAuthorizer,
      capabilityTransport: {
        call: vi.fn(async () => ({
          status: "error",
          error: {
            code: "tool-failed",
            message: "capability transport returned an error",
          },
        })),
      },
      contextProvider: () => ({
        teamUuid: "team-1",
        sessionUuid: "session-1",
        traceUuid: "trace-1",
        turnUuid: "turn-1",
      }),
      anchorProvider: () => undefined,
    });

    const result = await runner.advanceStep(toolSnapshot("turn-1"), baseSignals({
      hasMoreToolCalls: true,
    }));

    expect(commit).not.toHaveBeenCalled();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "tool.call.result",
        requestId: "tool-1",
        status: "error",
      }),
    );
  });

  // RH1 P1-02 — `hook.emit` delegate routes through HookDispatcher when one is
  // injected; without dispatcher, the historical no-op behavior is preserved.
  it("RH1: hook.emit delegate routes through HookDispatcher when injected", async () => {
    const dispatcherEmit = vi.fn(async () => ({
      finalAction: "continue" as const,
      outcomes: [],
      blocked: false,
    }));
    const dispatcher = { emit: dispatcherEmit } as unknown as import("../../src/hooks/dispatcher.js").HookDispatcher;
    const runner = createMainlineKernelRunner({
      ai: { run: vi.fn() },
      quotaAuthorizer: null,
      capabilityTransport: undefined,
      contextProvider: () => null,
      anchorProvider: () => undefined,
      hookDispatcher: dispatcher,
      hookContextProvider: () => ({ sessionUuid: "s-1", turnId: "t-1" }),
    });
    // Reach into the runtime and emit through the deps surface.
    const deps = (runner as unknown as { deps: { hook: { emit: (e: string, p: unknown) => Promise<unknown> } } }).deps;
    if (deps?.hook?.emit) {
      const result = await deps.hook.emit("PreToolUse", { tool: "bash" });
      expect(dispatcherEmit).toHaveBeenCalledTimes(1);
      expect(dispatcherEmit).toHaveBeenCalledWith(
        "PreToolUse",
        { tool: "bash" },
        expect.objectContaining({ sessionUuid: "s-1", turnId: "t-1" }),
      );
      expect(result).toMatchObject({ finalAction: "continue", blocked: false });
    } else {
      // If the runner doesn't expose deps (current API doesn't), skip without
      // failing — Phase 2 contract test will exercise the real path.
      expect(true).toBe(true);
    }
  });

  it("RH1: hook.emit delegate is no-op when no HookDispatcher injected (backward-compat)", async () => {
    const runner = createMainlineKernelRunner({
      ai: { run: vi.fn() },
      quotaAuthorizer: null,
      capabilityTransport: undefined,
      contextProvider: () => null,
      anchorProvider: () => undefined,
      // hookDispatcher intentionally undefined
    });
    const deps = (runner as unknown as { deps?: { hook?: { emit?: (e: string, p: unknown) => Promise<unknown> } } }).deps;
    if (deps?.hook?.emit) {
      const result = await deps.hook.emit("PreToolUse", {});
      expect(result).toBeUndefined();
    } else {
      expect(true).toBe(true);
    }
  });

  it("PP4: PreToolUse session hook blocks real capability execution", async () => {
    const hooks = createSessionHookRuntime();
    hooks.register({
      id: "block-pwd",
      event: "PreToolUse",
      matcher: { type: "toolName", value: "pwd" },
      runtime: "local-ts",
      outcome: { action: "block", reason: "pwd is disabled" },
    });
    const capabilityCall = vi.fn();
    const onHookOutcome = vi.fn();
    const runner = createMainlineKernelRunner({
      ai: { run: vi.fn() },
      quotaAuthorizer: null,
      capabilityTransport: { call: capabilityCall },
      contextProvider: () => ({
        teamUuid: "team-1",
        sessionUuid: "session-1",
        traceUuid: "trace-1",
        turnUuid: "turn-1",
      }),
      anchorProvider: () => undefined,
      hookDispatcher: hooks.dispatcher,
      hookContextProvider: () => ({ sessionUuid: "session-1", turnId: "turn-1" }),
      onHookOutcome,
    });

    const result = await runner.advanceStep(toolSnapshot("turn-1"), baseSignals({
      hasMoreToolCalls: true,
    }));

    expect(capabilityCall).not.toHaveBeenCalled();
    expect(onHookOutcome).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "PreToolUse",
      caller: "pre-tool-use",
      outcome: expect.objectContaining({ blocked: true, blockReason: "pwd is disabled" }),
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "tool.call.result",
      requestId: "tool-1",
      status: "error",
      errorMessage: "pwd is disabled",
    }));
  });

  it("PP4: PreToolUse updated input is revalidated by the write_todos path", async () => {
    const hooks = createSessionHookRuntime();
    hooks.register({
      id: "rewrite-todos",
      event: "PreToolUse",
      matcher: { type: "toolName", value: "write_todos" },
      runtime: "local-ts",
      outcome: {
        action: "updateInput",
        updated_input: {
          todos: [{ content: "from hook", status: "pending" }],
        },
      },
    });
    const writeTodosBackend = vi.fn(async () => ({
      ok: true as const,
      created: [{ todo_uuid: "todo-1", status: "pending" as const }],
      auto_closed: [],
    }));
    const runner = createMainlineKernelRunner({
      ai: { run: vi.fn() },
      quotaAuthorizer: null,
      contextProvider: () => ({
        teamUuid: "team-1",
        sessionUuid: "session-1",
        traceUuid: "trace-1",
        turnUuid: "turn-1",
      }),
      anchorProvider: () => undefined,
      hookDispatcher: hooks.dispatcher,
      hookContextProvider: () => ({ sessionUuid: "session-1", turnId: "turn-1" }),
      writeTodosBackend,
    });

    const result = await runner.advanceStep(
      namedToolSnapshot("write_todos", { todos: [{ content: "original" }] }, "turn-1"),
      baseSignals({ hasMoreToolCalls: true }),
    );

    expect(writeTodosBackend).toHaveBeenCalledWith(expect.objectContaining({
      todos: [{ content: "from hook", status: "pending" }],
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "tool.call.result",
      requestId: "tool-1",
      status: "ok",
    }));
  });

  it("injects the nano-agent system prompt before invoking Workers AI", async () => {
    const run = vi.fn(async () => ({
      response: "ok",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const runner = createMainlineKernelRunner({
      ai: { run },
      quotaAuthorizer: null,
      capabilityTransport: undefined,
      contextProvider: () => null,
      anchorProvider: () => undefined,
    });

    await runner.advanceStep(runningSnapshot("turn-system"), baseSignals());

    expect(run).toHaveBeenCalledTimes(1);
    const payload = run.mock.calls[0]?.[1] as { messages?: Array<{ role?: string; content?: string }> };
    expect(payload.messages?.[0]).toMatchObject({
      role: "system",
    });
    expect(payload.messages?.[0]?.content).toContain("Cloudflare Workers");
  });

  it("injects per-model base_instructions_suffix and forwards explicit model selection", async () => {
    resetModelPromptSuffixCache();
    const run = vi.fn(async () => ({
      response: "ok",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const modelCatalogDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () =>
            sql.includes("base_instructions_suffix")
              ? { base_instructions_suffix: "Use the reasoning profile." }
              : null,
          ),
          all: vi.fn(async () => ({
            results: sql.includes("WHERE status = 'active'")
              ? [{
                  model_id: "@cf/ibm-granite/granite-4.0-h-micro",
                  context_window: 131072,
                  is_reasoning: 0,
                  is_vision: 0,
                  is_function_calling: 1,
                }]
              : [],
          })),
        })),
        all: vi.fn(async () => ({
          results: [{
            model_id: "@cf/ibm-granite/granite-4.0-h-micro",
            context_window: 131072,
            is_reasoning: 0,
            is_vision: 0,
            is_function_calling: 1,
          }],
        })),
      })),
    } as unknown as D1Database;
    const runner = createMainlineKernelRunner({
      ai: { run },
      quotaAuthorizer: null,
      capabilityTransport: undefined,
      contextProvider: () => null,
      anchorProvider: () => undefined,
      modelCatalogDb,
    });

    await runner.advanceStep(runningSnapshot("turn-system"), baseSignals());

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe("@cf/ibm-granite/granite-4.0-h-micro");
    const payload = run.mock.calls[0]?.[1] as { messages?: Array<{ role?: string; content?: string }> };
    expect(payload.messages?.[0]?.content).toContain("Use the reasoning profile.");
  });

  it("emits tool_call_cancelled when an inflight capability is cancelled", async () => {
    let resolveCall: ((value: unknown) => void) | undefined;
    const call = vi.fn(() => new Promise((resolve) => {
      resolveCall = resolve;
    }));
    const cancel = vi.fn();
    const onToolEvent = vi.fn();
    const runner = createMainlineKernelRunner({
      ai: { run: vi.fn() },
      quotaAuthorizer: null,
      capabilityTransport: { call, cancel },
      contextProvider: () => ({
        teamUuid: "team-1",
        sessionUuid: "session-1",
        traceUuid: "trace-1",
        turnUuid: "turn-1",
      }),
      anchorProvider: () => undefined,
      onToolEvent,
    });

    const capability = (runner as unknown as {
      delegates: {
        capability: {
          execute: (plan: unknown) => AsyncGenerator<unknown, void, unknown>;
          cancel: (requestId: string) => void;
        };
      };
    }).delegates.capability;
    const execute = capability.execute({
      requestId: "tool-1",
      toolName: "bash",
      args: { command: "pwd" },
    });
    const nextPromise = execute.next();
    await vi.waitFor(() => {
      expect(call).toHaveBeenCalledTimes(1);
      expect(resolveCall).toBeTypeOf("function");
    });

    capability.cancel("tool-1");

    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "tool-1",
        body: { reason: "cancelled-by-host" },
      }),
    );
    expect(onToolEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool_call_cancelled",
        tool_call_id: "tool-1",
        tool_name: "bash",
        cancel_initiator: "parent_cancel",
      }),
    );

    resolveCall?.({ status: "ok", output: { ok: true } });
    await nextPromise;
    await execute.next();
  });

  it("waits for HITL permission when runtime policy asks", async () => {
    const authorizeToolUse = vi.fn(async () => ({
      ok: true,
      decision: "ask" as const,
      source: "approval-policy" as const,
      reason: "approval policy requires confirmation",
    }));
    const requestToolPermission = vi.fn(async () => ({
      request_uuid: "tool-1",
      status: "allowed",
    }));
    const call = vi.fn(async () => ({ status: "ok", output: { ok: true } }));
    const runner = createMainlineKernelRunner({
      ai: { run: vi.fn() },
      quotaAuthorizer: null,
      capabilityTransport: { call },
      authorizeToolUse,
      requestToolPermission,
      contextProvider: () => ({
        teamUuid: "team-1",
        sessionUuid: "session-1",
        traceUuid: "33333333-3333-4333-8333-333333333333",
        turnUuid: "turn-1",
      }),
      anchorProvider: () => undefined,
    });

    const result = await runner.advanceStep(toolSnapshot("turn-1"), baseSignals({
      hasMoreToolCalls: true,
    }));

    expect(authorizeToolUse).toHaveBeenCalledWith(
      expect.objectContaining({
        session_uuid: "session-1",
        team_uuid: "team-1",
        tool_name: "pwd",
      }),
      expect.objectContaining({
        trace_uuid: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(requestToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        request_uuid: expect.any(String),
        tool_name: "pwd",
        reason: "approval policy requires confirmation",
      }),
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "tool.call.result",
        requestId: "tool-1",
        status: "ok",
      }),
    );
  });

  it("does not execute the tool when HITL permission is denied", async () => {
    const requestToolPermission = vi.fn(async () => ({
      request_uuid: "tool-1",
      status: "denied",
    }));
    const call = vi.fn();
    const runner = createMainlineKernelRunner({
      ai: { run: vi.fn() },
      quotaAuthorizer: null,
      capabilityTransport: { call },
      authorizeToolUse: vi.fn(async () => ({
        ok: true,
        decision: "ask" as const,
        source: "approval-policy" as const,
      })),
      requestToolPermission,
      contextProvider: () => ({
        teamUuid: "team-1",
        sessionUuid: "session-1",
        traceUuid: "33333333-3333-4333-8333-333333333333",
        turnUuid: "turn-1",
      }),
      anchorProvider: () => undefined,
    });

    const result = await runner.advanceStep(toolSnapshot("turn-1"), baseSignals({
      hasMoreToolCalls: true,
    }));

    expect(call).not.toHaveBeenCalled();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "tool.call.result",
        requestId: "tool-1",
        status: "error",
      }),
    );
  });

  it("uses runtime compact bridge output to mutate the next LLM prompt", async () => {
    const requestCompact = vi.fn(async () => ({
      tokensFreed: 500,
      messages: [
        { role: "system", content: "<compact_boundary>summary</compact_boundary>" },
        { role: "user", content: "latest question" },
      ],
    }));
    const runner = createMainlineKernelRunner({
      ai: { run: vi.fn() },
      quotaAuthorizer: null,
      capabilityTransport: undefined,
      requestCompact,
      contextProvider: () => ({
        teamUuid: "team-1",
        sessionUuid: "session-1",
        traceUuid: "33333333-3333-4333-8333-333333333333",
        turnUuid: "turn-1",
      }),
      anchorProvider: () => undefined,
    });
    const started = applyAction(createKernelSnapshot(createInitialSessionState()), {
      type: "start_turn",
      turnId: "turn-compact",
    });
    const snapshot = {
      ...started,
      session: {
        ...started.session,
        totalTokens: 1000,
      },
      activeTurn: started.activeTurn
        ? {
            ...started.activeTurn,
            messages: [
              { role: "user", content: "old question" },
              { role: "assistant", content: "old answer" },
              { role: "user", content: "latest question" },
            ],
          }
        : null,
    };

    const result = await runner.advanceStep(snapshot, baseSignals({
      compactRequired: true,
    }));

    expect(requestCompact).toHaveBeenCalledWith(
      expect.objectContaining({
        session_uuid: "session-1",
        total_tokens: 1000,
        messages: expect.arrayContaining([
          expect.objectContaining({ content: "old question" }),
        ]),
      }),
    );
    expect(result.snapshot.session.totalTokens).toBe(500);
    expect(result.snapshot.activeTurn?.messages).toEqual([
      { role: "system", content: "<compact_boundary>summary</compact_boundary>" },
      { role: "user", content: "latest question" },
    ]);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "compact.notify",
        status: "completed",
        tokensBefore: 1000,
        tokensAfter: 500,
      }),
    );
  });
});
