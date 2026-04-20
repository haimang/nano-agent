/**
 * IntegratedProbeResult — Round-2 result shape consumed by
 * `scripts/extract-finding.ts` to seed round-2 closure sections on
 * the corresponding `docs/spikes/spike-do-storage/*.md` finding docs.
 *
 * Differences vs. Round 1 (`spikes/round-1-bare-metal/.../result-shape.ts`):
 *
 *   - `findingId` — the original B1 finding this probe addresses, so
 *     closure writeback is by finding, not by route.
 *   - `verdict` — one of `writeback-shipped / dismissed-with-rationale /
 *     still-open` per B7 §1.2 verdict vocabulary.
 *   - `usedPackages` — the `@nano-agent/*` seams the probe actually
 *     imported. Empty = pure follow-up raw probe; ≥1 = integration
 *     re-validation.
 *   - `caveats` — B2 `listAll()` bounded-sweep / `ReferenceBackend`
 *     cleanup and similar carry-forward caveats the probe is aware of.
 *   - `evidenceRefs` — pointers to `.out/{route}.json`, tail logs,
 *     finding doc sections, so the B7 phase-N closure issue can cite
 *     raw evidence.
 */

export interface IntegratedProbeObservation {
  readonly label: string;
  readonly value: unknown;
  readonly unit?: string;
}

export interface IntegratedProbeError {
  readonly code: string;
  readonly message: string;
  readonly count: number;
  readonly sample?: unknown;
}

export interface IntegratedProbeTimings {
  readonly p50Ms?: number;
  readonly p99Ms?: number;
  readonly maxMs?: number;
  readonly samplesN: number;
  readonly totalDurationMs: number;
}

/** Round-2 verdict vocabulary — per B7 action-plan §1.2. */
export type IntegratedVerdict =
  | "writeback-shipped"
  | "dismissed-with-rationale"
  | "still-open";

/** Execution mode — see README "Local simulation" vs deploy paths. */
export type ProbeMode = "local" | "deploy-dry-run" | "live";

export interface EvidenceRef {
  readonly kind: "out-json" | "tail-log" | "finding-doc" | "source";
  readonly locator: string;
}

export interface IntegratedProbeResult {
  readonly validationItemId: string;
  readonly findingId?: string;
  readonly verdict: IntegratedVerdict;
  readonly success: boolean;
  readonly skipped?: boolean;
  readonly gate?: string;
  readonly mode: ProbeMode;
  readonly usedPackages: ReadonlyArray<string>;
  readonly caveats: ReadonlyArray<string>;
  readonly observations: IntegratedProbeObservation[];
  readonly timings: IntegratedProbeTimings;
  readonly errors: IntegratedProbeError[];
  readonly rawSamples?: unknown[];
  readonly evidenceRefs: EvidenceRef[];
  readonly probeVersion: string;
  readonly capturedAt: string;
}

export const INTEGRATED_PROBE_VERSION = "0.0.0-spike-r2-2026-04-20";

export function makeIntegratedResult(
  validationItemId: string,
  start: number,
  partial: Omit<
    IntegratedProbeResult,
    "validationItemId" | "probeVersion" | "capturedAt" | "timings"
  > & {
    timings?: Partial<IntegratedProbeTimings>;
  },
): IntegratedProbeResult {
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
    probeVersion: INTEGRATED_PROBE_VERSION,
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

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

/** Short-circuit result used when a gate is unmet. */
export function gatedSkip(
  validationItemId: string,
  findingId: string,
  gate: string,
  rationale: string,
): IntegratedProbeResult {
  return makeIntegratedResult(validationItemId, Date.now(), {
    findingId,
    verdict: "still-open",
    success: false,
    skipped: true,
    gate,
    mode: "live",
    usedPackages: [],
    caveats: [rationale],
    observations: [
      { label: "gate", value: gate },
      { label: "rationale", value: rationale },
    ],
    errors: [],
    evidenceRefs: [],
    timings: { samplesN: 0 },
  });
}
