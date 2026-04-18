/**
 * A9 Phase 4 — remote seam upgrade path (P4-01).
 *
 * Proves the `curl` and `ts-exec` contracts survive a change of
 * execution target from `local-ts` to `service-binding` without any
 * handler, schema, or `tool.call.*` message change. This is the
 * minimum regression guard the plan promises when it says "local-ts is
 * just a reference path — remote tool-runner must be a drop-in swap".
 *
 * The test uses a fake `ServiceBindingTransport` that inspects the
 * `tool.call.request` body the target builds and synthesises a
 * `tool.call.response` from it. If a future change breaks the seam
 * (e.g. renames fields, drops capability name, re-shapes input), this
 * test fires immediately.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityExecutor } from "../../src/executor.js";
import type { TargetHandler } from "../../src/executor.js";
import { CapabilityPolicyGate } from "../../src/policy.js";
import { InMemoryCapabilityRegistry } from "../../src/registry.js";
import {
  ServiceBindingTarget,
  type ServiceBindingCallInput,
  type ServiceBindingTransport,
} from "../../src/targets/service-binding.js";
import type {
  CapabilityDeclaration,
  CapabilityPlan,
  ExecutionTarget,
} from "../../src/types.js";
import type { CapabilityEvent } from "../../src/events.js";
import type { ToolCallResponseBody } from "../../src/tool-call.js";

function registerRemote(
  registry: InMemoryCapabilityRegistry,
  name: string,
  kind: CapabilityDeclaration["kind"],
): void {
  registry.register({
    name,
    kind,
    description: `remote ${name}`,
    inputSchema: { type: "object" },
    executionTarget: "service-binding",
    policy: "allow",
  });
}

function planFor(name: string, input: Record<string, unknown>): CapabilityPlan {
  return {
    capabilityName: name,
    input,
    executionTarget: "service-binding",
    source: "structured-tool",
  };
}

async function drain(
  iter: AsyncIterable<CapabilityEvent>,
): Promise<CapabilityEvent[]> {
  const out: CapabilityEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe("remote seam upgrade — curl / ts-exec (A9 Phase 4)", () => {
  let registry: InMemoryCapabilityRegistry;
  let gate: CapabilityPolicyGate;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    gate = new CapabilityPolicyGate(registry);
  });

  it("routes a `curl` plan through service-binding and preserves the structured input", async () => {
    registerRemote(registry, "curl", "network");
    const seen: ServiceBindingCallInput[] = [];
    const transport: ServiceBindingTransport = {
      async call(input) {
        seen.push(input);
        const body: ToolCallResponseBody = {
          status: "ok",
          output: `remote echo ${(input.body.tool_input as { url: string }).url}`,
        };
        return body;
      },
    };
    const executor = new CapabilityExecutor(
      new Map<ExecutionTarget, TargetHandler>([
        ["service-binding", new ServiceBindingTarget(transport)],
      ]),
      gate,
    );

    const events = await drain(
      executor.executeStream(
        planFor("curl", {
          url: "https://api.example.com",
          method: "POST",
          headers: { "x-trace": "1" },
          body: "{}",
          timeoutMs: 5_000,
        }),
      ),
    );

    const terminal = events[events.length - 1]!;
    expect(terminal.kind).toBe("completed");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.body.tool_name).toBe("curl");
    expect(seen[0]!.body.tool_input).toEqual({
      url: "https://api.example.com",
      method: "POST",
      headers: { "x-trace": "1" },
      body: "{}",
      timeoutMs: 5_000,
    });
  });

  it("routes a `ts-exec` plan through service-binding and preserves the code field", async () => {
    registerRemote(registry, "ts-exec", "exec");
    const seen: ServiceBindingCallInput[] = [];
    const transport: ServiceBindingTransport = {
      async call(input) {
        seen.push(input);
        return {
          status: "ok",
          output: `[remote] acked ${(input.body.tool_input as { code: string }).code.length} chars`,
        };
      },
    };
    const executor = new CapabilityExecutor(
      new Map<ExecutionTarget, TargetHandler>([
        ["service-binding", new ServiceBindingTarget(transport)],
      ]),
      gate,
    );

    const events = await drain(
      executor.executeStream(planFor("ts-exec", { code: "1 + 2" })),
    );
    const terminal = events[events.length - 1]!;
    expect(terminal.kind).toBe("completed");
    expect(seen[0]!.body.tool_name).toBe("ts-exec");
    expect(seen[0]!.body.tool_input).toEqual({ code: "1 + 2" });
  });

  it("transport-level progress frames for curl/ts-exec surface as executor progress events", async () => {
    registerRemote(registry, "curl", "network");
    const transport: ServiceBindingTransport = {
      async call(input) {
        input.onProgress?.({ toolName: input.capabilityName, chunk: "headers-received", isFinal: false });
        input.onProgress?.({ toolName: input.capabilityName, chunk: "body-chunk", isFinal: true });
        return { status: "ok", output: "done" };
      },
    };
    const executor = new CapabilityExecutor(
      new Map<ExecutionTarget, TargetHandler>([
        ["service-binding", new ServiceBindingTarget(transport)],
      ]),
      gate,
    );

    const events = await drain(
      executor.executeStream(planFor("curl", { url: "https://example.com" })),
    );
    const progresses = events.filter((e) => e.kind === "progress");
    expect(progresses).toHaveLength(2);
  });
});
