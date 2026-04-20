/**
 * Re-validation — binding-F02 (lowercase header law) and binding-F03
 * (hook callback latency).
 *
 * B7-R2 honest scope (2026-04-20): this probe measures the raw
 * Cloudflare service-binding transport behaviour. It does NOT
 * import `@nano-agent/nacp-core` / `@nano-agent/nacp-session` /
 * `@nano-agent/eval-observability` — those packages' stamping /
 * session-profile / inspector seams are exercised by OTHER round-2
 * routes (binding-F04 uses `@nano-agent/session-do-runtime`'s
 * `BoundedEvalSink` on worker-b).
 *
 * The lowercase-header observation here is evidence of a platform
 * invariant nacp-core's `x-nacp-*` stamping depends on, but the
 * nacp-core code itself is not on this probe's call stack.
 */

import {
  makeBindingResult,
  type BindingProbeResult,
} from "../result-shape.js";

const SAMPLE_HEADER_KEYS = [
  "x-nacp-trace-uuid",
  "x-nacp-session-uuid",
  "x-nacp-team-uuid",
  "x-nacp-request-uuid",
];

export async function probeBindingReValidation(
  workerB: Fetcher,
): Promise<BindingProbeResult> {
  const start = Date.now();

  // ── binding-F02: lowercase header law ──
  const sentHeaders = {
    "X-NACP-Trace-Uuid": "00000000-0000-4000-8000-000000000001",
    "X-NACP-Session-Uuid": "00000000-0000-4000-8000-000000000002",
    "X-NACP-Team-Uuid": "00000000-0000-4000-8000-000000000003",
    "X-NACP-Request-Uuid": "00000000-0000-4000-8000-000000000004",
    "content-type": "application/json",
  };
  const headerResp = await workerB.fetch(
    new Request("https://worker-b/headers/dump", {
      method: "POST",
      headers: sentHeaders,
      body: "{}",
    }),
  );
  const headerBody = (await headerResp.json()) as {
    observedKeys: string[];
    headers: Record<string, string>;
  };
  const observedLowercased = SAMPLE_HEADER_KEYS.every((k) =>
    headerBody.observedKeys.includes(k),
  );
  const noOriginalCasing = SAMPLE_HEADER_KEYS.every(
    (k) => !headerBody.observedKeys.includes(k.toUpperCase()),
  );
  const f02Ok = observedLowercased && noOriginalCasing;

  // ── binding-F03: hook callback latency ──
  const HOOK_SAMPLES = 5;
  const HOOK_LATENCY_MS = 10;
  const latencies: number[] = [];
  for (let i = 0; i < HOOK_SAMPLES; i++) {
    const t0 = Date.now();
    const resp = await workerB.fetch(
      new Request("https://worker-b/hooks/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "re-validation",
          latencyMs: HOOK_LATENCY_MS,
        }),
      }),
    );
    if (!resp.ok) break;
    latencies.push(Date.now() - t0);
  }
  const f03Ok =
    latencies.length === HOOK_SAMPLES &&
    latencies.every((l) => l >= HOOK_LATENCY_MS && l < HOOK_LATENCY_MS + 500);

  const allOk = f02Ok && f03Ok;
  return makeBindingResult("V3-binding-revalidation", start, {
    findingId: "binding-F02/binding-F03",
    verdict: allOk ? "writeback-shipped" : "still-open",
    success: allOk,
    mode: "live",
    // B7-R2 honesty fix: this probe does NOT import `@nano-agent/nacp-core`
    // (see file header). Previous value was wrong — correct value is empty.
    // The lowercase-law evidence is captured at the raw wire level; the
    // shipped `nacp-core` stamping sits on top of this platform guarantee
    // and is exercised elsewhere (`/probe/follow-ups/binding-f04-true-callback`
    // goes through `@nano-agent/session-do-runtime`, which re-exports the
    // nacp-session wire shape).
    usedPackages: [],
    caveats: [
      "probe observes raw Cloudflare service-binding transport; nacp-core stamping is NOT on this probe's call stack",
      "lowercase-law evidence is a platform invariant nacp-core depends on",
      "hook-latency baseline is a smoke check; B8 worker-matrix owns the full percentile distribution",
    ],
    observations: [
      { label: "F02.lowercaseObserved", value: observedLowercased },
      { label: "F02.noOriginalCasing", value: noOriginalCasing },
      { label: "F02.observedKeys", value: headerBody.observedKeys },
      { label: "F03.sampleCount", value: latencies.length },
      { label: "F03.minLatencyMs", value: Math.min(...(latencies.length ? latencies : [0])) },
      { label: "F03.maxLatencyMs", value: Math.max(...(latencies.length ? latencies : [0])) },
    ],
    errors: allOk
      ? []
      : [
          {
            code: "binding-revalidation-fail",
            message: `F02=${f02Ok} F03=${f03Ok}`,
            count: 1,
          },
        ],
    evidenceRefs: [
      {
        kind: "finding-doc",
        locator: "docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md",
      },
      {
        kind: "finding-doc",
        locator: "docs/spikes/spike-binding-pair/03-hooks-callback-latency-and-error-shape-confirmed.md",
      },
    ],
    timings: { samplesN: SAMPLE_HEADER_KEYS.length + latencies.length },
  });
}
