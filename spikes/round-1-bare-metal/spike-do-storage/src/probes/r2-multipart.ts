/**
 * V1-storage-R2-multipart probe.
 *
 * Validation goal (per P0-spike-do-storage-design §4.1):
 *   - Determine single-part upload limit
 *   - Determine when R2 binding `put()` actually requires multipart
 *   - Determine partial-failure / cleanup behavior
 *
 * Strategy: upload deterministic blobs at increasing sizes; record
 * success / failure / latency / error code per size.
 */

import { makeResult, percentile, type ProbeResult } from "../result-shape.js";

const SIZES_BYTES = [
  1 * 1024,
  100 * 1024,
  1 * 1024 * 1024,
  5 * 1024 * 1024,
  10 * 1024 * 1024,
  // Larger sizes (50MB+) are gated to avoid burning quota on every probe run.
  // Enable by setting `large=true` in probe params.
];

const LARGE_SIZES_BYTES = [
  50 * 1024 * 1024,
  100 * 1024 * 1024,
];

function deterministicBlob(bytes: number, seedTag: string): Uint8Array {
  // Cheap PRNG so each (bytes, seedTag) is reproducible.
  const buf = new Uint8Array(bytes);
  let s = 1;
  for (let i = 0; i < seedTag.length; i++) s = (s * 31 + seedTag.charCodeAt(i)) >>> 0;
  for (let i = 0; i < bytes; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    buf[i] = s & 0xff;
  }
  return buf;
}

export async function probeR2Multipart(
  r2: R2Bucket,
  params: { large?: boolean; clean?: boolean },
): Promise<ProbeResult> {
  const start = Date.now();
  const sizes = params.large ? [...SIZES_BYTES, ...LARGE_SIZES_BYTES] : SIZES_BYTES;
  const observations: ProbeResult["observations"] = [];
  const errors: ProbeResult["errors"] = [];
  const latencies: number[] = [];
  const rawSamples: unknown[] = [];

  for (const bytes of sizes) {
    const key = `multipart-probe/${bytes}-${start}`;
    const blob = deterministicBlob(bytes, `r2-multipart-${bytes}`);
    const t0 = Date.now();
    try {
      const obj = await r2.put(key, blob);
      const t1 = Date.now();
      const dt = t1 - t0;
      latencies.push(dt);
      observations.push({
        label: `put_success_${bytes}b`,
        value: { bytes, latencyMs: dt, etag: obj?.etag, size: obj?.size },
      });
      rawSamples.push({ bytes, latencyMs: dt, etag: obj?.etag });
      if (params.clean) {
        await r2.delete(key);
      }
    } catch (err) {
      const t1 = Date.now();
      const dt = t1 - t0;
      const errCode = (err as { name?: string })?.name ?? "UnknownError";
      const msg = String((err as Error)?.message ?? err);
      errors.push({ code: errCode, message: msg, count: 1, sample: { bytes, latencyMs: dt } });
      observations.push({
        label: `put_failure_${bytes}b`,
        value: { bytes, latencyMs: dt, errorCode: errCode },
      });
    }
  }

  return makeResult("V1-storage-R2-multipart", start, {
    success: errors.length === 0,
    observations,
    errors,
    rawSamples,
    timings: {
      samplesN: latencies.length,
      p50Ms: percentile(latencies, 0.5),
      p99Ms: percentile(latencies, 0.99),
      maxMs: latencies.length ? Math.max(...latencies) : 0,
    },
  });
}
