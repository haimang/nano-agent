/**
 * Follow-up F09 — `curl` high-volume against owner-supplied URL.
 *
 * Round 1 observed 25 fetches against a default target without rate
 * limiting; B1 left "what happens at 50 / 100 / 200 / 500 / 1000?"
 * to B7. The conservative curl budget in `@nano-agent/capability-runtime`
 * (B3) needs that calibration to know whether to stay conservative or
 * be widened.
 *
 * This probe is **gated** on `env.F09_OWNER_URL`. Per B7 §6.2 #4,
 * without an owner-supplied URL this probe MUST NOT run against
 * Cloudflare-owned public endpoints — that would be 429-trip-wire
 * territory and would pollute the closure verdict.
 *
 * When gated it returns `still-open / gated`. The probe itself does
 * not import `@nano-agent/*` — it's measuring platform behaviour.
 * B8 / worker-matrix will be the consumer of the calibrated budget.
 */

import {
  gatedSkip,
  makeIntegratedResult,
  percentile,
  type IntegratedProbeResult,
} from "../result-shape.js";

const VOLUMES = [50, 100, 200, 500, 1000] as const;

export interface RunCurlHighVolumeOptions {
  readonly ownerUrl?: string;
  readonly volumes?: ReadonlyArray<number>;
  readonly requestTimeoutMs?: number;
}

interface VolumeResult {
  readonly volume: number;
  readonly okCount: number;
  readonly errCount: number;
  readonly status429Count: number;
  readonly status5xxCount: number;
  readonly timeoutCount: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

async function fetchOnce(
  url: string,
  timeoutMs: number,
): Promise<{
  ok: boolean;
  status: number;
  ms: number;
  timeout: boolean;
}> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return {
      ok: resp.ok,
      status: resp.status,
      ms: Date.now() - t0,
      timeout: false,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      timeout: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeCurlHighVolume(
  opts: RunCurlHighVolumeOptions = {},
): Promise<IntegratedProbeResult> {
  const ownerUrl = opts.ownerUrl?.trim();
  if (!ownerUrl) {
    return gatedSkip(
      "V2-bash-curl-high-volume",
      "spike-do-storage-F09",
      "F09-OWNER-URL-MISSING",
      "probe requires owner-supplied public URL via env.F09_OWNER_URL; default URL MUST NOT be substituted (B7 §6.2 #4)",
    );
  }

  const start = Date.now();
  const volumes = opts.volumes ?? VOLUMES;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 5000;

  const perVolume: VolumeResult[] = [];

  for (const volume of volumes) {
    const tasks: Promise<{
      ok: boolean;
      status: number;
      ms: number;
      timeout: boolean;
    }>[] = [];
    for (let i = 0; i < volume; i++) {
      tasks.push(fetchOnce(ownerUrl, requestTimeoutMs));
    }
    const results = await Promise.all(tasks);
    const latencies = results.map((r) => r.ms);
    const okCount = results.filter((r) => r.ok).length;
    const errCount = results.filter((r) => !r.ok).length;
    const status429Count = results.filter((r) => r.status === 429).length;
    const status5xxCount = results.filter((r) => r.status >= 500).length;
    const timeoutCount = results.filter((r) => r.timeout).length;

    perVolume.push({
      volume,
      okCount,
      errCount,
      status429Count,
      status5xxCount,
      timeoutCount,
      p50Ms: percentile(latencies, 0.5),
      p99Ms: percentile(latencies, 0.99),
      maxMs: Math.max(0, ...latencies),
    });

    // Stop early if we hit 50%+ 429s — budget calibration is done,
    // continuing would just flood the owner's URL.
    if (status429Count > volume / 2) break;
  }

  const lastClean = [...perVolume]
    .reverse()
    .find((v) => v.status429Count === 0 && v.status5xxCount === 0 && v.timeoutCount === 0);

  // If any volume had trouble: writeback-shipped with the safe baseline;
  // if everything was clean at the highest level: dismissed-with-rationale.
  const verdict =
    lastClean && lastClean.volume === volumes[volumes.length - 1]
      ? "dismissed-with-rationale"
      : "writeback-shipped";

  return makeIntegratedResult("V2-bash-curl-high-volume", start, {
    findingId: "spike-do-storage-F09",
    verdict,
    success: lastClean !== undefined,
    mode: "live",
    usedPackages: [],
    caveats: [
      `owner URL only; no default-URL fallback`,
      `volumes attempted: ${volumes.join(", ")}; stopped at first 50%+ 429 bucket`,
      `safe high-watermark observed: ${lastClean?.volume ?? "none"}`,
    ],
    observations: perVolume.flatMap((v) => [
      { label: `vol-${v.volume}.ok`, value: v.okCount },
      { label: `vol-${v.volume}.429`, value: v.status429Count },
      { label: `vol-${v.volume}.5xx`, value: v.status5xxCount },
      { label: `vol-${v.volume}.timeout`, value: v.timeoutCount },
      { label: `vol-${v.volume}.p99Ms`, value: v.p99Ms, unit: "ms" },
    ]),
    errors: [],
    rawSamples: perVolume,
    evidenceRefs: [
      {
        kind: "finding-doc",
        locator: "docs/spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md",
      },
    ],
    timings: {
      samplesN: perVolume.reduce((s, v) => s + v.volume, 0),
    },
  });
}
