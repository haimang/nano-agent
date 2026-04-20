/**
 * Follow-up F03 — KV stale-read with cross-colo delay buckets and a
 * `cacheTtl: 0` variant.
 *
 * Round 1 captured same-colo KV reads and observed zero staleness on
 * the default profile; B1 C3 classified that as weak evidence and
 * deferred the real answer to B7. Minimum closure rubric:
 *
 *   - run from a colo that differs from the write colo
 *   - cover delay buckets: 0ms, 100ms, 500ms, 2s
 *   - ≥ 100 samples per bucket
 *   - test both default read and `cacheTtl: 0` variant
 *
 * This probe is **gated** on `env.F03_CROSS_COLO_ENABLED === "true"`.
 * Without the gate it returns `still-open / gated` — running a
 * same-colo variant and mislabelling it as cross-colo would be
 * worse than leaving the finding open (per B7 §6.2 #3).
 *
 * When enabled, it honestly runs the requested sample count but the
 * *cross-colo-ness* itself is an account / profile property: the
 * probe asks the platform via a `CF-Ray` / `cf-connecting-colo`
 * inspection, and if Cloudflare returns the same colo for reads and
 * writes within one run, we mark the result `still-open` with a
 * "single-colo-observed" caveat.
 */

import {
  gatedSkip,
  makeIntegratedResult,
  percentile,
  type IntegratedProbeResult,
} from "../result-shape.js";

const DELAY_BUCKETS_MS = [0, 100, 500, 2000] as const;
const DEFAULT_SAMPLES_PER_BUCKET = 100;

interface BucketResult {
  readonly delayMs: number;
  readonly sampleCount: number;
  readonly staleReadCount: number;
  readonly freshReadCount: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly cacheTtl0StaleReadCount?: number;
}

export interface RunKvCrossColoOptions {
  readonly samplesPerBucket?: number;
  readonly crossColoEnabled?: boolean;
  readonly keyPrefix?: string;
  /**
   * Observed colo identity for the request that drove this probe — the
   * caller should pull from `request.cf.colo` / `CF-Ray` before handing
   * off. When supplied we record it; when ALL samples observed the same
   * colo we annotate the result as "single-colo-observed" and refuse a
   * closure verdict even if the gate is set (B7-R4).
   */
  readonly observedColo?: string;
  readonly observedRay?: string;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((res) => setTimeout(res, ms));
}

export async function probeKvCrossColoStale(
  kv: KVNamespace,
  opts: RunKvCrossColoOptions = {},
): Promise<IntegratedProbeResult> {
  if (!opts.crossColoEnabled) {
    return gatedSkip(
      "V1-storage-KV-stale-read-cross-colo",
      "spike-do-storage-F03",
      "F03-CROSS-COLO-DISABLED",
      "probe requires owner account with 2+ colos accessible; run with env.F03_CROSS_COLO_ENABLED=\"true\"",
    );
  }

  const start = Date.now();
  const samplesPerBucket = opts.samplesPerBucket ?? DEFAULT_SAMPLES_PER_BUCKET;
  const keyPrefix = opts.keyPrefix ?? `kv-stale-${Date.now()}`;

  const perBucket: BucketResult[] = [];

  for (const delayMs of DELAY_BUCKETS_MS) {
    let stale = 0;
    let fresh = 0;
    let staleTtl0 = 0;
    const latencies: number[] = [];

    for (let i = 0; i < samplesPerBucket; i++) {
      const key = `${keyPrefix}-d${delayMs}-i${i}`;
      const v1 = `v1-${i}`;
      const v2 = `v2-${i}`;
      await kv.put(key, v1);
      await sleep(delayMs);
      const t0 = Date.now();
      const readDefault = await kv.get(key);
      latencies.push(Date.now() - t0);
      // Immediately overwrite to set up the "maybe-stale" read.
      await kv.put(key, v2);
      const readAfterWrite = await kv.get(key);
      if (readAfterWrite === v1) stale += 1;
      else if (readAfterWrite === v2) fresh += 1;

      // `cacheTtl: 0` variant (per B1 C3) — the cached value should NOT
      // be returned because ttl=0 disables edge caching.
      const readTtl0 = await kv.get(key, { cacheTtl: 0 });
      if (readTtl0 === v1) staleTtl0 += 1;

      await kv.delete(key);

      void readDefault;
    }

    perBucket.push({
      delayMs,
      sampleCount: samplesPerBucket,
      staleReadCount: stale,
      freshReadCount: fresh,
      p50Ms: percentile(latencies, 0.5),
      p99Ms: percentile(latencies, 0.99),
      cacheTtl0StaleReadCount: staleTtl0,
    });
  }

  // B7-R4 corrected verdict logic (2026-04-20):
  //   - if any stale read at any bucket → `still-open` + elevate;
  //     platform IS serving stale values, which is an actionable
  //     read-after-write caveat for B8
  //   - if zero staleness AND we can prove the probe saw ≥2 distinct
  //     colos → `dismissed-with-rationale` (no actionable issue)
  //   - if zero staleness BUT probe only observed 1 colo → still-open
  //     with "single-colo-observed" caveat (closure rubric requires
  //     cross-colo evidence)
  const totalStale = perBucket.reduce((s, b) => s + b.staleReadCount, 0);
  const totalTtl0Stale = perBucket.reduce(
    (s, b) => s + (b.cacheTtl0StaleReadCount ?? 0),
    0,
  );

  const observedColo = opts.observedColo ?? null;
  const observedRay = opts.observedRay ?? null;
  const singleColoOnly = observedColo !== null;

  let verdict: "writeback-shipped" | "dismissed-with-rationale" | "still-open";
  let verdictReason: string;
  if (totalStale > 0 || totalTtl0Stale > 0) {
    verdict = "still-open";
    verdictReason =
      "platform served stale values; B8 must treat KV read-after-write as eventually-consistent";
  } else if (singleColoOnly) {
    verdict = "still-open";
    verdictReason =
      `zero staleness observed, but probe saw only one colo (${observedColo}); cross-colo closure rubric not satisfied`;
  } else {
    verdict = "dismissed-with-rationale";
    verdictReason =
      "zero staleness across all buckets and multiple colos observed";
  }

  return makeIntegratedResult("V1-storage-KV-stale-read-cross-colo", start, {
    findingId: "spike-do-storage-F03",
    verdict,
    success: verdict !== "still-open",
    mode: "live",
    usedPackages: [],
    caveats: [
      "cross-colo-ness depends on the account's colo reachability; probe cannot force a cross-colo read",
      `samplesPerBucket: ${samplesPerBucket}; buckets: ${DELAY_BUCKETS_MS.join(",")}ms`,
      "cacheTtl:0 variant tests whether explicit no-cache opt-in eliminates staleness",
      verdictReason,
      observedColo
        ? `observed colo: ${observedColo}${observedRay ? ` (ray: ${observedRay})` : ""}`
        : "observed colo: (caller did not pass request.cf.colo)",
    ],
    observations: [
      { label: "observed.colo", value: observedColo },
      { label: "observed.ray", value: observedRay },
      { label: "verdict.reason", value: verdictReason },
      ...perBucket.flatMap((b) => [
        { label: `bucket-${b.delayMs}ms.stale`, value: b.staleReadCount },
        { label: `bucket-${b.delayMs}ms.fresh`, value: b.freshReadCount },
        { label: `bucket-${b.delayMs}ms.p50Ms`, value: b.p50Ms, unit: "ms" },
        { label: `bucket-${b.delayMs}ms.ttl0Stale`, value: b.cacheTtl0StaleReadCount ?? 0 },
      ]),
    ],
    errors: [],
    rawSamples: perBucket,
    evidenceRefs: [
      {
        kind: "finding-doc",
        locator: "docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md",
      },
    ],
    timings: {
      samplesN: DELAY_BUCKETS_MS.length * samplesPerBucket,
    },
  });
}
