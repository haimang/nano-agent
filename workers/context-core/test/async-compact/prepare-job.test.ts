/**
 * B4 — async-compact PrepareJob tests.
 *
 * Verifies the background-LLM call wrapper:
 *   - happy path returns a PreparedSummary with byte length
 *   - timeout aborts via AbortSignal and throws PrepareJobTimeoutError
 *   - non-timeout errors propagate unchanged
 *   - signal cancellation honoured even if provider ignores signal
 */

import { describe, it, expect } from "vitest";
import {
  PrepareJob,
  PrepareJobTimeoutError,
} from "../../src/async-compact/prepare-job.js";
import type {
  ContextCandidate,
  LlmSummarizeProvider,
} from "../../src/async-compact/types.js";

const candidate: ContextCandidate = {
  snapshotVersion: 3,
  takenAt: "2026-04-20T00:00:00.000Z",
  layers: [],
  tokenEstimate: 1234,
};

function fakeProvider(
  impl: (signal: AbortSignal) => Promise<{ text: string }>,
): LlmSummarizeProvider {
  return {
    summarize: async (request) => impl(request.signal),
  };
}

describe("PrepareJob — happy path", () => {
  it("returns a PreparedSummary with correctly computed byte length", async () => {
    const job = new PrepareJob({
      provider: fakeProvider(async () => ({ text: "hello \u{1F600}" })),
      timeoutMs: 5_000,
      idFactory: () => "fixed-prep-id",
    });
    const result = await job.run({ candidate, sessionUuid: "s-1" });
    expect(result.prepareJobId).toBe("fixed-prep-id");
    expect(result.snapshotVersion).toBe(3);
    expect(result.text).toBe("hello \u{1F600}");
    // "hello " (6 ASCII) + emoji (4 bytes) = 10
    expect(result.sizeBytes).toBe(10);
    expect(() => new Date(result.producedAt)).not.toThrow();
  });
});

describe("PrepareJob — timeout", () => {
  it("throws PrepareJobTimeoutError when provider exceeds the budget", async () => {
    const job = new PrepareJob({
      provider: fakeProvider(
        (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
      timeoutMs: 25,
    });
    await expect(job.run({ candidate, sessionUuid: "s-1" })).rejects.toBeInstanceOf(
      PrepareJobTimeoutError,
    );
  });

  it("preserves non-timeout errors", async () => {
    const job = new PrepareJob({
      provider: fakeProvider(async () => {
        throw new Error("provider exploded");
      }),
      timeoutMs: 1_000,
    });
    await expect(job.run({ candidate, sessionUuid: "s-1" })).rejects.toThrow(
      "provider exploded",
    );
  });

  it("PrepareJobTimeoutError exposes timeoutMs", () => {
    const err = new PrepareJobTimeoutError(25_000);
    expect(err.timeoutMs).toBe(25_000);
    expect(err.message).toContain("25000ms");
  });
});

describe("PrepareJob — signal cancellation parity", () => {
  it("treats provider that ignores signal but resolves after abort as timeout", async () => {
    // Provider resolves AFTER the timer aborts the signal.
    const job = new PrepareJob({
      provider: fakeProvider((signal) =>
        new Promise((resolve) => {
          setTimeout(() => {
            // signal.aborted is true at this point because we set
            // timeoutMs below the resolve delay.
            void signal;
            resolve({ text: "late" });
          }, 30);
        }),
      ),
      timeoutMs: 5,
    });
    await expect(job.run({ candidate, sessionUuid: "s-1" })).rejects.toBeInstanceOf(
      PrepareJobTimeoutError,
    );
  });
});
