import { describe, expect, it } from "vitest";
import { tryEmitSystemError } from "../../src/observability/logger/system-error.js";

describe("tryEmitSystemError", () => {
  it("dual-emits system.error and system.notify(error) during RHX2 compatibility window", async () => {
    const emitted: unknown[] = [];
    const fallback: unknown[] = [];

    const result = await tryEmitSystemError({
      code: "spike-system-error",
      source_worker: "orchestrator-core",
      trace_uuid: "11111111-1111-4111-8111-111111111111",
      message: "synthetic error",
      emit: async (frame) => {
        emitted.push(frame);
        return { delivered: true };
      },
      fallbackNotify: async (payload) => {
        fallback.push(payload);
      },
    });

    expect(result).toMatchObject({ emitted: true, delivered: true });
    expect(emitted).toHaveLength(1);
    expect(fallback).toEqual([
      {
        kind: "system.notify",
        severity: "error",
        message: "synthetic error",
        code: "spike-system-error",
        trace_uuid: "11111111-1111-4111-8111-111111111111",
      },
    ]);
  });

  it("can disable compatibility notify for the Phase 9 single-emit gate", async () => {
    const fallback: unknown[] = [];

    await tryEmitSystemError({
      code: "spike-system-error",
      source_worker: "orchestrator-core",
      message: "synthetic error",
      dualEmitSystemNotifyError: false,
      emit: async () => ({ delivered: true }),
      fallbackNotify: async (payload) => {
        fallback.push(payload);
      },
    });

    expect(fallback).toEqual([]);
  });
});
