/**
 * IntegratedBindingProbeResult — re-export of the storage r2 result
 * shape (they share the same structure). Duplicated only so each
 * worker's tsconfig stays self-contained (wrangler compiles per
 * worker dir).
 */

export interface BindingProbeObservation {
  readonly label: string;
  readonly value: unknown;
  readonly unit?: string;
}

export interface BindingProbeError {
  readonly code: string;
  readonly message: string;
  readonly count: number;
  readonly sample?: unknown;
}

export interface BindingProbeTimings {
  readonly p50Ms?: number;
  readonly p99Ms?: number;
  readonly maxMs?: number;
  readonly samplesN: number;
  readonly totalDurationMs: number;
}

export type BindingVerdict =
  | "writeback-shipped"
  | "dismissed-with-rationale"
  | "still-open";

export interface BindingEvidenceRef {
  readonly kind: "out-json" | "tail-log" | "finding-doc" | "source";
  readonly locator: string;
}

export interface BindingProbeResult {
  readonly validationItemId: string;
  readonly findingId?: string;
  readonly verdict: BindingVerdict;
  readonly success: boolean;
  readonly skipped?: boolean;
  readonly gate?: string;
  readonly mode: "local" | "deploy-dry-run" | "live";
  readonly usedPackages: ReadonlyArray<string>;
  readonly caveats: ReadonlyArray<string>;
  readonly observations: BindingProbeObservation[];
  readonly timings: BindingProbeTimings;
  readonly errors: BindingProbeError[];
  readonly rawSamples?: unknown[];
  readonly evidenceRefs: BindingEvidenceRef[];
  readonly probeVersion: string;
  readonly capturedAt: string;
}

export const BINDING_PROBE_VERSION = "0.0.0-spike-r2-a-2026-04-20";

export function makeBindingResult(
  validationItemId: string,
  start: number,
  partial: Omit<
    BindingProbeResult,
    "validationItemId" | "probeVersion" | "capturedAt" | "timings"
  > & {
    timings?: Partial<BindingProbeTimings>;
  },
): BindingProbeResult {
  const totalDurationMs = Date.now() - start;
  return {
    validationItemId,
    findingId: partial.findingId,
    verdict: partial.verdict,
    success: partial.success,
    skipped: partial.skipped,
    gate: partial.gate,
    mode: partial.mode,
    usedPackages: partial.usedPackages,
    caveats: partial.caveats,
    observations: partial.observations,
    errors: partial.errors,
    rawSamples: partial.rawSamples,
    evidenceRefs: partial.evidenceRefs,
    probeVersion: BINDING_PROBE_VERSION,
    capturedAt: new Date().toISOString(),
    timings: {
      samplesN: partial.timings?.samplesN ?? 0,
      totalDurationMs,
      p50Ms: partial.timings?.p50Ms,
      p99Ms: partial.timings?.p99Ms,
      maxMs: partial.timings?.maxMs,
    },
  };
}
