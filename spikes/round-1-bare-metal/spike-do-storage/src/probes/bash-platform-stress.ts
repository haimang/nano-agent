/**
 * V2B-bash-platform-stress probe.
 *
 * Validation goal (per P0-spike-do-storage-design r2 §4.8):
 *   Discover Cloudflare Worker runtime boundaries:
 *     - DO state.storage memory at increasing payload size
 *     - cpu_ms via grep-style scan over many keys
 *     - subrequest count (covered by V2-bash-curl-quota)
 *
 * Findings here feed Phase 2 fake-bash quota guard + Phase 3 budget policy.
 *
 * NOTE: Boundary-finding probes intentionally try sizes/counts that
 * MAY trigger platform errors. The probe captures the error and
 * continues — the error itself IS the finding.
 */

import { makeResult, type ProbeResult } from "../result-shape.js";

const PAYLOAD_SIZES = [
  1 * 1024,
  100 * 1024,
  1 * 1024 * 1024,
  10 * 1024 * 1024,
];

const SCAN_KEY_COUNTS = [10, 100, 500];

export async function probeBashPlatformStress(
  doNs: DurableObjectNamespace,
  _params: Record<string, unknown>,
): Promise<ProbeResult> {
  const start = Date.now();
  const observations: ProbeResult["observations"] = [];
  const errors: ProbeResult["errors"] = [];

  const id = doNs.idFromName("platform-stress-probe");
  const stub = doNs.get(id);

  // Memory probe: write payloads of increasing size to DO storage.
  for (const sizeBytes of PAYLOAD_SIZES) {
    try {
      const t0 = Date.now();
      const res = await stub.fetch(
        new Request("https://probe-do/stress-memory", {
          method: "POST",
          body: JSON.stringify({ sizeBytes }),
          headers: { "content-type": "application/json" },
        }),
      );
      const body = (await res.json()) as Record<string, unknown>;
      observations.push({
        label: `memory_${sizeBytes}b`,
        value: { sizeBytes, latencyMs: Date.now() - t0, ...body },
      });
    } catch (err) {
      errors.push({
        code: "MemoryStressFailed",
        message: String((err as Error)?.message ?? err),
        count: 1,
        sample: { sizeBytes },
      });
    }
  }

  // CPU stress: scan increasingly many keys with a regex on a small payload each.
  for (const keyCount of SCAN_KEY_COUNTS) {
    try {
      const t0 = Date.now();
      const res = await stub.fetch(
        new Request("https://probe-do/stress-cpu-scan", {
          method: "POST",
          body: JSON.stringify({ keyCount }),
          headers: { "content-type": "application/json" },
        }),
      );
      const body = (await res.json()) as Record<string, unknown>;
      observations.push({
        label: `cpu_scan_${keyCount}_keys`,
        value: { keyCount, latencyMs: Date.now() - t0, ...body },
      });
    } catch (err) {
      errors.push({
        code: "CpuStressFailed",
        message: String((err as Error)?.message ?? err),
        count: 1,
        sample: { keyCount },
      });
    }
  }

  return makeResult("V2B-bash-platform-stress", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: PAYLOAD_SIZES.length + SCAN_KEY_COUNTS.length },
  });
}
