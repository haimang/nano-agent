/**
 * Follow-up unexpected-F01 — R2 concurrent `put()` baseline.
 *
 * Round 1 observed ~273 ms/key on single-threaded R2 `put()` during
 * pre-seed. B1 deferred "what does concurrent put look like?" to B7
 * because answering it informs `R2Adapter.putParallel()` calibration.
 *
 * This probe fires N parallel `put()` requests at a fresh bucket, then
 * `delete()`s them so the bucket does not accumulate state between runs.
 * It records p50 / p99 / max per concurrency level and any
 * `R2Error` / 429 it observes.
 *
 * Safe concurrency ceiling is a property of the account, not the code,
 * so the closure verdict is "writeback-shipped" when the run produces a
 * stable p50 curve — B2 (storage-topology) can then pick an
 * account-safe default. If any level returns errors, the verdict stays
 * "still-open" for owner-side investigation.
 */

import {
  makeIntegratedResult,
  percentile,
  type IntegratedProbeResult,
} from "../result-shape.js";

const CONCURRENCY_LEVELS = [10, 50, 100, 200] as const;
const DEFAULT_VALUE_BYTES = 1024;

export interface RunR2ConcurrentOptions {
  readonly levels?: ReadonlyArray<number>;
  readonly valueBytes?: number;
  readonly keyPrefix?: string;
}

async function putOnce(
  bucket: R2Bucket,
  key: string,
  payload: Uint8Array,
): Promise<{ ms: number; ok: boolean; error?: string }> {
  const started = Date.now();
  try {
    await bucket.put(key, payload);
    return { ms: Date.now() - started, ok: true };
  } catch (err) {
    return {
      ms: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeR2ConcurrentPut(
  bucket: R2Bucket,
  opts: RunR2ConcurrentOptions = {},
): Promise<IntegratedProbeResult> {
  const start = Date.now();
  const levels = opts.levels ?? CONCURRENCY_LEVELS;
  const valueBytes = opts.valueBytes ?? DEFAULT_VALUE_BYTES;
  const keyPrefix = opts.keyPrefix ?? `r2-concurrent-${Date.now()}`;

  const payload = new Uint8Array(valueBytes);
  const perLevel: Array<{
    concurrency: number;
    p50Ms: number;
    p99Ms: number;
    maxMs: number;
    errorCount: number;
  }> = [];
  const errors: Array<{ code: string; message: string; count: number }> = [];

  for (const concurrency of levels) {
    const tasks: Promise<{ ms: number; ok: boolean; error?: string }>[] = [];
    for (let i = 0; i < concurrency; i++) {
      tasks.push(putOnce(bucket, `${keyPrefix}-L${concurrency}-i${i}`, payload));
    }
    const results = await Promise.all(tasks);
    const latencies = results.filter((r) => r.ok).map((r) => r.ms);
    const errorCount = results.filter((r) => !r.ok).length;
    for (const r of results) {
      if (!r.ok && r.error) {
        const existing = errors.find((e) => e.message === r.error);
        if (existing) (existing as { count: number }).count += 1;
        else errors.push({ code: "r2-put-error", message: r.error, count: 1 });
      }
    }
    perLevel.push({
      concurrency,
      p50Ms: percentile(latencies, 0.5),
      p99Ms: percentile(latencies, 0.99),
      maxMs: latencies.length ? Math.max(...latencies) : 0,
      errorCount,
    });
    // Cleanup so the bucket does not accumulate.
    await Promise.all(
      results.map((_, i) =>
        bucket
          .delete(`${keyPrefix}-L${concurrency}-i${i}`)
          .catch(() => undefined),
      ),
    );
  }

  const totalErrors = errors.reduce((s, e) => s + e.count, 0);
  const verdict =
    totalErrors === 0 ? "writeback-shipped" : "still-open";

  return makeIntegratedResult("V1-storage-R2-concurrent-put", start, {
    findingId: "unexpected-F01",
    verdict,
    success: totalErrors === 0,
    mode: "live",
    usedPackages: [],
    caveats: [
      "R2 put latency is account-scoped; B2 must pick a safe default based on owner's baseline",
      `concurrency levels: ${levels.join(", ")}`,
    ],
    observations: perLevel.flatMap((lv) => [
      { label: `level-${lv.concurrency}.p50Ms`, value: lv.p50Ms, unit: "ms" },
      { label: `level-${lv.concurrency}.p99Ms`, value: lv.p99Ms, unit: "ms" },
      { label: `level-${lv.concurrency}.maxMs`, value: lv.maxMs, unit: "ms" },
      { label: `level-${lv.concurrency}.errorCount`, value: lv.errorCount },
    ]),
    errors,
    rawSamples: perLevel,
    evidenceRefs: [
      {
        kind: "finding-doc",
        locator: "docs/spikes/unexpected/F01-r2-put-273ms-per-key-during-preseed.md",
      },
    ],
    timings: {
      samplesN: levels.reduce((s, c) => s + c, 0),
    },
  });
}
