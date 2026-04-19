/**
 * V3-binding-latency-cancellation probe.
 *
 * Validation goal (per P0-spike-binding-pair-design §4.1):
 *   - service binding p50/p99 latency baseline
 *   - payload-size scaling
 *   - concurrent backpressure
 *   - cancellation: does worker-a abort propagate to worker-b?
 *   - timeout error shape
 *
 * Transport scope: only the fetch-based seam
 * (binding.fetch(new Request(...))). NOT validating handleNacp RPC.
 */

import { makeResult, percentile, type BindingProbeResult } from "../result-shape.js";

export async function probeLatencyCancellation(
  workerB: Fetcher,
  params: {
    baselineSamples?: number;
    payloadSizes?: number[];
    concurrentN?: number;
    cancelDelayMs?: number;
  },
): Promise<BindingProbeResult> {
  const start = Date.now();
  const observations: BindingProbeResult["observations"] = [];
  const errors: BindingProbeResult["errors"] = [];
  const rawSamples: unknown[] = [];

  // (1) Baseline: small payload echo × N
  const baselineN = params.baselineSamples ?? 30;
  const baselineLatencies: number[] = [];
  for (let i = 0; i < baselineN; i++) {
    const t0 = Date.now();
    try {
      const res = await workerB.fetch(
        new Request("https://worker-b.spike/handle/echo", {
          method: "POST",
          body: `ping-${i}`,
        }),
      );
      await res.arrayBuffer();
      baselineLatencies.push(Date.now() - t0);
    } catch (err) {
      errors.push({
        code: "BaselineFetchFailed",
        message: String((err as Error)?.message ?? err),
        count: 1,
        sample: { i },
      });
    }
  }
  observations.push({
    label: "baseline_latency_1KiB_echo",
    value: {
      samples: baselineN,
      p50Ms: percentile(baselineLatencies, 0.5),
      p99Ms: percentile(baselineLatencies, 0.99),
      maxMs: baselineLatencies.length ? Math.max(...baselineLatencies) : 0,
    },
  });
  rawSamples.push({ baselineLatencies });

  // (2) Payload scaling
  const sizes = params.payloadSizes ?? [1024, 10 * 1024, 100 * 1024, 1024 * 1024];
  const scalingByLatency: Record<number, number[]> = {};
  for (const sz of sizes) {
    const payload = "x".repeat(sz);
    const lats: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      try {
        const res = await workerB.fetch(
          new Request("https://worker-b.spike/handle/echo", {
            method: "POST",
            body: payload,
          }),
        );
        await res.arrayBuffer();
        lats.push(Date.now() - t0);
      } catch (err) {
        errors.push({
          code: "PayloadScalingFailed",
          message: String((err as Error)?.message ?? err),
          count: 1,
          sample: { sizeBytes: sz },
        });
      }
    }
    scalingByLatency[sz] = lats;
  }
  observations.push({
    label: "payload_scaling",
    value: Object.fromEntries(
      Object.entries(scalingByLatency).map(([sz, lats]) => [
        `${sz}b`,
        {
          samples: lats.length,
          p50Ms: percentile(lats, 0.5),
          maxMs: lats.length ? Math.max(...lats) : 0,
        },
      ]),
    ),
  });

  // (3) Concurrent fan-out
  const concurrentN = params.concurrentN ?? 20;
  try {
    const concT0 = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: concurrentN }, (_, i) =>
        workerB.fetch(
          new Request("https://worker-b.spike/handle/echo", {
            method: "POST",
            body: `concurrent-${i}`,
          }),
        ),
      ),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const concDuration = Date.now() - concT0;
    observations.push({
      label: "concurrent_fanout",
      value: {
        requested: concurrentN,
        succeeded,
        failed: concurrentN - succeeded,
        wallClockMs: concDuration,
        avgPerCallMs: Math.round(concDuration / Math.max(1, succeeded)),
      },
    });
  } catch (err) {
    errors.push({
      code: "ConcurrentFanoutFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (4) Cancellation: kick a slow request, abort after cancelDelayMs.
  const cancelDelayMs = params.cancelDelayMs ?? 500;
  const slowMs = 5000;
  try {
    const ctrl = new AbortController();
    const t0 = Date.now();
    const promise = workerB.fetch(
      new Request(`https://worker-b.spike/handle/slow/${slowMs}`, {
        method: "POST",
        body: "abort-test",
        signal: ctrl.signal,
      }),
    );
    setTimeout(() => ctrl.abort(), cancelDelayMs);
    let observedAtA: { aborted: boolean; durationMs: number; resp?: unknown };
    try {
      const res = await promise;
      const body = await res.json();
      observedAtA = {
        aborted: false,
        durationMs: Date.now() - t0,
        resp: body,
      };
    } catch (err) {
      observedAtA = {
        aborted: true,
        durationMs: Date.now() - t0,
        resp: { error: String((err as Error)?.message ?? err) },
      };
    }
    observations.push({
      label: "cancellation",
      value: {
        cancelDelayMs,
        slowMs,
        observedAtCaller: observedAtA,
        // Note: whether worker-b actually saw the abort can be confirmed
        // via wrangler tail (slow.ts logs "[slow] abort observed" if so).
        note: "Check worker-b wrangler tail for `[slow] abort observed`.",
      },
    });
  } catch (err) {
    errors.push({
      code: "CancellationProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  return makeResult("V3-binding-latency-cancellation", start, {
    success: errors.length === 0,
    observations,
    errors,
    rawSamples,
    timings: {
      samplesN: baselineN + sizes.length * 5 + concurrentN + 1,
      p50Ms: percentile(baselineLatencies, 0.5),
      p99Ms: percentile(baselineLatencies, 0.99),
      maxMs: baselineLatencies.length ? Math.max(...baselineLatencies) : 0,
    },
  });
}
