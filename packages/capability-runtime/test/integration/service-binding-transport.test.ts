/**
 * Integration: ServiceBindingTarget — transport roundtrip.
 *
 * Exercises the `ServiceBindingTransport` seam end-to-end through the
 * `CapabilityExecutor.executeStream()` pipeline using a fake transport
 * that:
 *   1. pushes progress frames during a call,
 *   2. returns a successful `tool.call.response` body, and
 *   3. records any `tool.call.cancel` sent by the target.
 *
 * Regression guard for 2nd-round GPT R1: the service-binding target
 * must NOT be a permanent `not-connected` stub — it must route through
 * an injectable transport so streaming + cancel roundtrips can flow.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityExecutor } from "../../src/executor.js";
import type { TargetHandler } from "../../src/executor.js";
import { CapabilityPolicyGate } from "../../src/policy.js";
import { InMemoryCapabilityRegistry } from "../../src/registry.js";
import {
  ServiceBindingTarget,
  type ServiceBindingTransport,
  type ServiceBindingCallInput,
  type ServiceBindingCancelInput,
} from "../../src/targets/service-binding.js";
import type {
  CapabilityPlan,
  ExecutionTarget,
  CapabilityDeclaration,
} from "../../src/types.js";
import type { ToolCallResponseBody } from "../../src/tool-call.js";
import type { CapabilityEvent } from "../../src/events.js";

function makeDecl(name: string): CapabilityDeclaration {
  return {
    name,
    kind: "exec",
    description: `Test ${name}`,
    inputSchema: {},
    executionTarget: "service-binding",
    policy: "allow",
  };
}

function makePlan(name: string, input: Record<string, unknown> = {}): CapabilityPlan {
  return {
    capabilityName: name,
    input,
    executionTarget: "service-binding",
    source: "structured-tool",
  };
}

async function collect(
  iter: AsyncIterable<CapabilityEvent>,
): Promise<CapabilityEvent[]> {
  const out: CapabilityEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe("integration: ServiceBindingTarget transport roundtrip", () => {
  let registry: InMemoryCapabilityRegistry;
  let gate: CapabilityPolicyGate;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    gate = new CapabilityPolicyGate(registry);
  });

  it("returns not-connected when no transport is supplied", async () => {
    registry.register(makeDecl("remote-tool"));
    const target = new ServiceBindingTarget();
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["service-binding", target],
    ]);
    const executor = new CapabilityExecutor(targets, gate);

    const events = await collect(executor.executeStream(makePlan("remote-tool")));
    const terminal = events[events.length - 1]!;
    expect(terminal.kind).toBe("error");
    if (terminal.kind === "error") {
      expect(terminal.detail).toMatchObject({
        result: expect.objectContaining({
          error: expect.objectContaining({ code: "not-connected" }),
        }),
      });
    }
  });

  it("streams progress frames from the transport as progress events", async () => {
    registry.register(makeDecl("remote-tool"));

    const transport: ServiceBindingTransport = {
      async call(input: ServiceBindingCallInput) {
        input.onProgress?.({
          toolName: input.capabilityName,
          chunk: "partial-1",
          isFinal: false,
        });
        input.onProgress?.({
          toolName: input.capabilityName,
          chunk: "partial-2",
          isFinal: true,
        });
        const resp: ToolCallResponseBody = {
          status: "ok",
          output: "ok-final",
        };
        return resp;
      },
    };

    const target = new ServiceBindingTarget(transport);
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["service-binding", target],
    ]);
    const executor = new CapabilityExecutor(targets, gate);

    const events = await collect(executor.executeStream(makePlan("remote-tool")));
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("started");
    expect(kinds[kinds.length - 1]).toBe("completed");

    const progresses = events.filter((e) => e.kind === "progress");
    expect(progresses).toHaveLength(2);
    const chunks = progresses
      .map((e) =>
        e.kind === "progress" && e.detail && typeof e.detail === "object"
          ? (e.detail as { chunk?: string }).chunk
          : undefined,
      )
      .filter(Boolean);
    expect(chunks).toEqual(["partial-1", "partial-2"]);
  });

  it("maps transport call rejection to a transport-error CapabilityResult", async () => {
    registry.register(makeDecl("broken-tool"));

    const transport: ServiceBindingTransport = {
      async call(): Promise<ToolCallResponseBody> {
        throw new Error("network exploded");
      },
    };

    const target = new ServiceBindingTarget(transport);
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["service-binding", target],
    ]);
    const executor = new CapabilityExecutor(targets, gate);

    const events = await collect(executor.executeStream(makePlan("broken-tool")));
    const terminal = events[events.length - 1]!;
    expect(terminal.kind).toBe("error");
    if (terminal.kind === "error") {
      const d = terminal.detail as {
        result?: {
          error?: { code?: string; message?: string };
        };
      };
      expect(d.result?.error?.code).toBe("transport-error");
      expect(d.result?.error?.message).toContain("network exploded");
    }
  });

  it("invokes transport.cancel() when executor cancels mid-flight", async () => {
    registry.register(makeDecl("slow-tool"));

    const cancelCalls: ServiceBindingCancelInput[] = [];
    const transport: ServiceBindingTransport = {
      async call(input: ServiceBindingCallInput): Promise<ToolCallResponseBody> {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), 200);
          input.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
        return { status: "ok", output: "done" };
      },
      async cancel(input: ServiceBindingCancelInput): Promise<void> {
        cancelCalls.push(input);
      },
    };

    const target = new ServiceBindingTarget(transport);
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["service-binding", target],
    ]);
    const executor = new CapabilityExecutor(targets, gate);

    const iter = executor.executeStream(makePlan("slow-tool"))[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.value?.kind).toBe("started");
    const requestId = first.value!.requestId;

    setTimeout(() => executor.cancel(requestId), 10);

    // Drain to terminal.
    let terminal: CapabilityEvent | undefined;
    while (true) {
      const step = await iter.next();
      if (step.done) break;
      terminal = step.value;
    }
    expect(terminal?.kind).toBe("cancelled");

    // Transport must have received a tool.call.cancel for this requestId.
    expect(cancelCalls.length).toBeGreaterThan(0);
    expect(cancelCalls[0]!.body.reason).toBe("cancelled by caller");
  });

  it("patches parsed CapabilityResult with plan.capabilityName + requestId", async () => {
    registry.register(makeDecl("named-tool"));

    const transport: ServiceBindingTransport = {
      async call(input: ServiceBindingCallInput) {
        const resp: ToolCallResponseBody = {
          status: "ok",
          output: `hello ${input.capabilityName}`,
        };
        return resp;
      },
    };

    const target = new ServiceBindingTarget(transport);
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["service-binding", target],
    ]);
    const executor = new CapabilityExecutor(targets, gate);

    const events = await collect(executor.executeStream(makePlan("named-tool")));
    const terminal = events[events.length - 1]!;
    expect(terminal.kind).toBe("completed");
    if (terminal.kind === "completed") {
      const d = terminal.detail as {
        result?: {
          capabilityName?: string;
          requestId?: string;
          output?: string;
        };
      };
      expect(d.result?.capabilityName).toBe("named-tool");
      // requestId should be the executor-minted id, not the target's id,
      // because the terminal event carries the stream requestId.
      expect(d.result?.requestId).toBe(terminal.requestId);
      expect(d.result?.output).toBe("hello named-tool");
    }
  });
});
