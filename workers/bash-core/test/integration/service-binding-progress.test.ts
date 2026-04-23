/**
 * Integration: executeStream() — lifecycle events + cancel path.
 *
 * Uses a fake TargetHandler whose execute() returns a promise that
 * resolves only after a delay (so the test has a window to call
 * executor.cancel()). The handler listens on the AbortSignal and
 * rejects early with an AbortError when cancelled, which the executor
 * must translate to a `cancelled` event.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityExecutor } from "../../src/executor.js";
import type { TargetHandler } from "../../src/executor.js";
import { CapabilityPolicyGate } from "../../src/policy.js";
import { InMemoryCapabilityRegistry } from "../../src/registry.js";
import type {
  CapabilityPlan,
  ExecutionTarget,
  CapabilityDeclaration,
} from "../../src/types.js";
import type { CapabilityResult } from "../../src/result.js";
import type { CapabilityEvent } from "../../src/events.js";

function makeDecl(name: string, policy: "allow" | "ask" | "deny"): CapabilityDeclaration {
  return {
    name,
    kind: "exec",
    description: `Test ${name}`,
    inputSchema: {},
    executionTarget: "local-ts",
    policy,
  };
}

function makePlan(name: string): CapabilityPlan {
  return {
    capabilityName: name,
    input: { work: "stream" },
    executionTarget: "local-ts",
    source: "structured-tool",
  };
}

/** Handler that resolves slowly, honouring AbortSignal. */
class SlowSignalTarget implements TargetHandler {
  constructor(private delayMs: number) {}
  async execute(plan: CapabilityPlan, signal?: AbortSignal): Promise<CapabilityResult> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve();
      }, this.delayMs);
      if (signal) {
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
    return {
      kind: "inline",
      capabilityName: plan.capabilityName,
      requestId: "slow-req",
      output: "finished",
      durationMs: 0,
    };
  }
}

async function collect(
  iter: AsyncIterable<CapabilityEvent>,
): Promise<CapabilityEvent[]> {
  const events: CapabilityEvent[] = [];
  for await (const evt of iter) {
    events.push(evt);
  }
  return events;
}

describe("integration: executeStream lifecycle", () => {
  let registry: InMemoryCapabilityRegistry;
  let gate: CapabilityPolicyGate;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    gate = new CapabilityPolicyGate(registry);
  });

  it("yields started -> completed for a fast handler", async () => {
    registry.register(makeDecl("fast", "allow"));
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["local-ts", new SlowSignalTarget(5)],
    ]);
    const executor = new CapabilityExecutor(targets, gate);

    const events = await collect(executor.executeStream(makePlan("fast")));

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.kind).toBe("started");
    expect(events[events.length - 1]!.kind).toBe("completed");
  });

  it("yields started -> error for a policy-denied plan", async () => {
    registry.register(makeDecl("locked", "deny"));
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["local-ts", new SlowSignalTarget(5)],
    ]);
    const executor = new CapabilityExecutor(targets, gate);

    const events = await collect(executor.executeStream(makePlan("locked")));
    expect(events[0]!.kind).toBe("started");
    expect(events[events.length - 1]!.kind).toBe("error");
  });

  it("yields started -> cancelled when cancel() fires mid-flight", async () => {
    registry.register(makeDecl("slow", "allow"));
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["local-ts", new SlowSignalTarget(200)],
    ]);
    const executor = new CapabilityExecutor(targets, gate);

    // Start streaming
    const iterator = executor.executeStream(makePlan("slow"))[Symbol.asyncIterator]();

    // The first event should be `started` — pull it and capture requestId.
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value?.kind).toBe("started");
    const requestId = first.value!.requestId;

    // Fire cancel before the handler resolves.
    setTimeout(() => executor.cancel(requestId), 10);

    // The next event should terminate the stream.
    const second = await iterator.next();
    expect(second.value?.kind).toBe("cancelled");

    // And the stream should be done.
    const third = await iterator.next();
    expect(third.done).toBe(true);
  });

  it("cancel() on an unknown requestId is a no-op", () => {
    const executor = new CapabilityExecutor(new Map(), gate);
    expect(() => executor.cancel("no-such-req")).not.toThrow();
  });

  it("timeout aborts the underlying handler and yields timeout event", async () => {
    registry.register(makeDecl("slow", "allow"));
    const targets = new Map<ExecutionTarget, TargetHandler>([
      ["local-ts", new SlowSignalTarget(500)],
    ]);
    const executor = new CapabilityExecutor(targets, gate, { timeoutMs: 30 });

    const events = await collect(executor.executeStream(makePlan("slow")));
    expect(events[0]!.kind).toBe("started");
    expect(events[events.length - 1]!.kind).toBe("timeout");
  });
});
