/**
 * ProbeResult — shape consumed by extract-finding.ts to seed
 * docs/spikes/spike-do-storage/{NN}-{slug}.md drafts.
 *
 * Aligned with docs/templates/_TEMPLATE-spike-finding.md §1.2 and §6.1
 * field expectations.
 */

export interface ProbeObservation {
  readonly label: string;
  readonly value: unknown;
  readonly unit?: string;
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

export interface ProbeResult {
  readonly validationItemId: string; // e.g. V1-storage-R2-multipart
  readonly success: boolean;
  readonly observations: ProbeObservation[];
  readonly timings: ProbeTimings;
  readonly errors: ProbeError[];
  readonly rawSamples?: unknown[];
  readonly probeVersion: string;
  readonly capturedAt: string; // ISO8601
}

export const PROBE_VERSION = "0.0.0-spike-p2";

export function makeResult(
  validationItemId: string,
  start: number,
  partial: Omit<ProbeResult, "validationItemId" | "probeVersion" | "capturedAt" | "timings"> & {
    timings?: Partial<ProbeTimings>;
  },
): ProbeResult {
  const totalDurationMs = Date.now() - start;
  return {
    validationItemId,
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
