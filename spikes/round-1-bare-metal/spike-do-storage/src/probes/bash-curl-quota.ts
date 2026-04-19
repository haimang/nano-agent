/**
 * V2-bash-curl-quota probe.
 *
 * Validation goal (per P0-spike-do-storage-design §4.9):
 *   - Single-turn outbound subrequest count limit
 *   - Per-fetch payload size affecting limit
 *   - Error shape when limit hit (503? specific code?)
 *
 * Per owner B1 Q2: target URL is supplied via probe params (caller must
 * provide). Default falls back to a static text URL on workers.dev that
 * always responds with a tiny payload, suitable for counting.
 *
 * **NOTE**: as of P2-05 ship, the default target is a placeholder.
 * Owner has indicated they will supply preferred target URL when this
 * probe is first executed.
 */

import { makeResult, percentile, type ProbeResult } from "../result-shape.js";

// Stable, no-auth, low-payload public endpoint suitable for subrequest counting.
// Owner can override via probe params.
const DEFAULT_TARGET_URL = "https://example.com/";

const SUBREQUEST_COUNTS = [10, 25, 50, 75];

export async function probeBashCurlQuota(
  params: { target?: string; counts?: number[] },
): Promise<ProbeResult> {
  const start = Date.now();
  const target = params.target ?? DEFAULT_TARGET_URL;
  const counts = params.counts ?? SUBREQUEST_COUNTS;

  const observations: ProbeResult["observations"] = [];
  const errors: ProbeResult["errors"] = [];

  observations.push({
    label: "config",
    value: { target, counts },
  });

  for (const count of counts) {
    const latencies: number[] = [];
    let succeeded = 0;
    let failed = 0;
    const failureCodes: Record<string, number> = {};

    for (let i = 0; i < count; i++) {
      const t0 = Date.now();
      try {
        const res = await fetch(`${target}?probe=${i}&t=${Date.now()}`, {
          method: "GET",
          headers: { "x-spike-probe": "v2-curl-quota" },
        });
        // Fully read body so subrequest is "consumed".
        await res.arrayBuffer();
        const dt = Date.now() - t0;
        latencies.push(dt);
        if (res.ok) {
          succeeded++;
        } else {
          failed++;
          const code = `HTTP_${res.status}`;
          failureCodes[code] = (failureCodes[code] ?? 0) + 1;
        }
      } catch (err) {
        failed++;
        const code = (err as { name?: string })?.name ?? "FetchError";
        const msg = String((err as Error)?.message ?? err);
        failureCodes[code] = (failureCodes[code] ?? 0) + 1;
        errors.push({
          code,
          message: msg,
          count: 1,
          sample: { i, count, target },
        });
      }
    }

    observations.push({
      label: `count_${count}`,
      value: {
        count,
        succeeded,
        failed,
        failureCodes,
        p50Ms: percentile(latencies, 0.5),
        p99Ms: percentile(latencies, 0.99),
      },
    });
  }

  observations.push({
    label: "owner_prompt",
    value:
      "Per owner B1 Q2: when first run, please supply preferred test URL " +
      "via probe params (default uses example.com which is rate-limited).",
  });

  return makeResult("V2-bash-curl-quota", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: counts.reduce((a, b) => a + b, 0) },
  });
}
