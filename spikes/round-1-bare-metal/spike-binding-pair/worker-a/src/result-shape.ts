/**
 * BindingProbeResult — shape consumed by extract-finding.ts to seed
 * docs/spikes/spike-binding-pair/{NN}-{slug}.md drafts.
 *
 * Aligned with docs/templates/_TEMPLATE-spike-finding.md §1.2 and §6.1
 * field expectations.
 *
 * Transport scope (per design §0): all metrics here describe the
 * fetch-based service binding seam ONLY. RPC handleNacp transport is
 * out of scope.
 */

export interface ProbeObservation {
  readonly label: string;
  readonly value: unknown;
}

export interface ProbeError {
  readonly code: string;
  readonly message: string;
  readonly count: number;
  readonly sample?: unknown;
}

export interface ProbeTimings {
  readonly p50Ms?: number;
  readonly p99Ms?: number;
  readonly maxMs?: number;
  readonly samplesN: number;
  readonly totalDurationMs: number;
}

export interface BindingProbeResult {
  readonly validationItemId: string; // e.g. V3-binding-latency-cancellation
  readonly success: boolean;
  readonly transportScope: "fetch-based-seam";
  readonly observations: ProbeObservation[];
  readonly timings: ProbeTimings;
  readonly errors: ProbeError[];
  readonly rawSamples?: unknown[];
  readonly probeVersion: string;
  readonly capturedAt: string;
}

export const PROBE_VERSION = "0.0.0-spike-p3";

export function makeResult(
  validationItemId: string,
  start: number,
  partial: Omit<
    BindingProbeResult,
    "validationItemId" | "probeVersion" | "capturedAt" | "timings" | "transportScope"
  > & {
    timings?: Partial<ProbeTimings>;
  },
): BindingProbeResult {
  const totalDurationMs = Date.now() - start;
  return {
    validationItemId,
    transportScope: "fetch-based-seam",
    probeVersion: PROBE_VERSION,
    capturedAt: new Date().toISOString(),
    timings: {
      samplesN: partial.timings?.samplesN ?? 0,
      totalDurationMs,
      p50Ms: partial.timings?.p50Ms,
      p99Ms: partial.timings?.p99Ms,
      maxMs: partial.timings?.maxMs,
    },
    success: partial.success,
    observations: partial.observations,
    errors: partial.errors,
    rawSamples: partial.rawSamples,
  };
}

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}
