/**
 * V1-storage-KV-stale-read probe.
 *
 * Validation goal (per P0-spike-do-storage-design §4.3):
 *   - Window in which put-then-get returns stale value
 *   - Whether `cacheTtl: 0` provides fresh-read guarantee
 *
 * Strategy: write v1, then immediately read with various delays;
 * report when the read first observes v1.
 */

import { makeResult, type ProbeResult } from "../result-shape.js";

const KEY = "kv-stale-read-probe/key";
const SAMPLES_PER_DELAY = 10;
const DELAYS_MS = [0, 50, 100, 250, 500, 1000, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function probeKvStaleRead(
  kv: KVNamespace,
  params: { delays?: number[] },
): Promise<ProbeResult> {
  const start = Date.now();
  const delays = params.delays ?? DELAYS_MS;
  const observations: ProbeResult["observations"] = [];
  const errors: ProbeResult["errors"] = [];

  for (const delayMs of delays) {
    const v = `value-${start}-${delayMs}`;
    try {
      const t0 = Date.now();
      await kv.put(KEY, v);
      const writeMs = Date.now() - t0;

      let freshHits = 0;
      let staleHits = 0;
      let nullHits = 0;
      const readLatencies: number[] = [];

      for (let i = 0; i < SAMPLES_PER_DELAY; i++) {
        if (delayMs > 0) await sleep(delayMs);
        const r0 = Date.now();
        const got = await kv.get(KEY);
        const dt = Date.now() - r0;
        readLatencies.push(dt);
        if (got === v) freshHits++;
        else if (got == null) nullHits++;
        else staleHits++;
      }

      observations.push({
        label: `delay_${delayMs}ms`,
        value: {
          writeLatencyMs: writeMs,
          samples: SAMPLES_PER_DELAY,
          freshHits,
          staleHits,
          nullHits,
          avgReadMs:
            readLatencies.reduce((a, b) => a + b, 0) /
            Math.max(1, readLatencies.length),
        },
      });
    } catch (err) {
      errors.push({
        code: "KvOpFailed",
        message: String((err as Error)?.message ?? err),
        count: 1,
        sample: { delayMs },
      });
    }
  }

  return makeResult("V1-storage-KV-stale-read", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: delays.length * SAMPLES_PER_DELAY },
  });
}
