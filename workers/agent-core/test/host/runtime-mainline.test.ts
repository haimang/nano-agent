import { describe, expect, it, vi } from "vitest";
import { applyAction } from "../../src/kernel/reducer.js";
import { createInitialSessionState, createKernelSnapshot } from "../../src/kernel/state.js";
import type { SchedulerSignals } from "../../src/kernel/scheduler.js";
import { createMainlineKernelRunner } from "../../src/host/runtime-mainline.js";
import type { QuotaAuthorizer } from "../../src/host/quota/authorizer.js";

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
});
