/**
 * A5 Phase 2 — ServiceBindingRuntime tests.
 *
 * Covers the real runtime (not the test harness' FakeServiceBindingRuntime):
 *   - `not-connected` when no transport is wired,
 *   - happy path through an injected transport,
 *   - transport errors map to `HookRuntimeError("transport-error")`,
 *   - AbortSignal routed through `signalFromContext` short-circuits.
 */

import { describe, it, expect, vi } from "vitest";
import {
  ServiceBindingRuntime,
  HookRuntimeError,
  type HookTransport,
} from "../../../src/hooks/runtimes/service-binding.js";
import type { HookHandlerConfig } from "../../../src/hooks/types.js";
import { HookEmitBodySchema } from "@haimang/nacp-core";

const HANDLER: HookHandlerConfig = {
  id: "remote-hook",
  source: "session",
  event: "PreToolUse",
  runtime: "service-binding",
  timeoutMs: 500,
};

describe("ServiceBindingRuntime", () => {
  it("throws not-connected when no transport is wired", async () => {
    const runtime = new ServiceBindingRuntime();
    await expect(
      runtime.execute(HANDLER, { tool_name: "Bash" }, {}),
    ).rejects.toBeInstanceOf(HookRuntimeError);
    try {
      await runtime.execute(HANDLER, {}, {});
    } catch (e) {
      expect((e as HookRuntimeError).reason).toBe("not-connected");
    }
  });

  it("sends a schema-valid hook.emit body through the transport and returns a parsed outcome", async () => {
    const call = vi.fn().mockImplementation(async ({ emitBody }) => {
      expect(HookEmitBodySchema.safeParse(emitBody).success).toBe(true);
      return { body: { ok: true, additional_context: "allowed" }, durationMs: 3 };
    });
    const transport: HookTransport = { call };
    const runtime = new ServiceBindingRuntime({ transport });
    const outcome = await runtime.execute(
      HANDLER,
      { tool_name: "Bash", tool_input: "ls" },
      {},
    );
    expect(outcome.action).toBe("continue");
    expect(outcome.additionalContext).toBe("allowed");
    expect(call).toHaveBeenCalledOnce();
  });

  it("maps transport errors to transport-error (not a raw exception)", async () => {
    const transport: HookTransport = {
      call: async () => {
        throw new Error("boom");
      },
    };
    const runtime = new ServiceBindingRuntime({ transport });
    try {
      await runtime.execute(HANDLER, {}, {});
    } catch (e) {
      expect(e).toBeInstanceOf(HookRuntimeError);
      expect((e as HookRuntimeError).reason).toBe("transport-error");
    }
  });

  it("short-circuits with cancelled when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport: HookTransport = {
      call: vi.fn(),
    };
    const runtime = new ServiceBindingRuntime({
      transport,
      signalFromContext: () => controller.signal,
    });
    try {
      await runtime.execute(HANDLER, {}, {});
    } catch (e) {
      expect((e as HookRuntimeError).reason).toBe("cancelled");
    }
    expect(transport.call).not.toHaveBeenCalled();
  });

  it("maps post-call abort into cancelled", async () => {
    const controller = new AbortController();
    const transport: HookTransport = {
      call: async () => {
        controller.abort();
        throw new Error("post-abort upstream error");
      },
    };
    const runtime = new ServiceBindingRuntime({
      transport,
      signalFromContext: () => controller.signal,
    });
    try {
      await runtime.execute(HANDLER, {}, {});
    } catch (e) {
      expect((e as HookRuntimeError).reason).toBe("cancelled");
    }
  });
});
