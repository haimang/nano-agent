/**
 * Follow-up F08 — DO `state.storage.put` size cap binary-search.
 *
 * Round 1 pinned the threshold to **[1 MiB, 10 MiB]** but only from two
 * samples (the accuracy required a follow-up probe per B1 C1 rubric).
 *
 * This probe drives `IntegratedProbeDO::/cap-binary-search` through a
 * bisection loop so the caller sees the converged `[lowBytes, highBytes]`
 * where `widthBytes <= 1024` (1 KiB resolution). Each bisection step runs
 * inside the DO so we measure the REAL storage engine decision, not a
 * local simulation of it.
 *
 * The probe itself does not `import "@nano-agent/*"` — it validates the
 * platform's raw cap. Finding writeback then feeds into B2
 * `storage-topology` calibration (out of scope for B7 itself).
 */

import {
  makeIntegratedResult,
  type IntegratedProbeResult,
} from "../result-shape.js";

interface BinarySearchAttempt {
  readonly sizeBytes: number;
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly elapsedMs: number;
  readonly samples?: number;
  readonly successfulSamples?: number;
}

interface BinarySearchResponse {
  readonly ok: boolean;
  readonly lowBytes: number;
  readonly highBytes: number;
  readonly widthBytes: number;
  readonly converged: boolean;
  readonly attemptCount: number;
  readonly attempts: ReadonlyArray<BinarySearchAttempt>;
}

export interface RunCapBinarySearchOptions {
  readonly maxAttempts?: number;
  readonly resolutionBytes?: number;
  readonly samplesPerStep?: number;
}

export async function probeDoSizeCapBinarySearch(
  doStub: DurableObjectStub,
  opts: RunCapBinarySearchOptions = {},
): Promise<IntegratedProbeResult> {
  const start = Date.now();
  const maxAttempts = opts.maxAttempts ?? 16;
  const resolutionBytes = opts.resolutionBytes ?? 1024;
  const samplesPerStep = Math.max(1, opts.samplesPerStep ?? 3);

  // Reset prior state so the binary-search starts from a clean [1 MiB, 10 MiB].
  await doStub.fetch(
    new Request("https://do/cap-binary-search-reset", { method: "POST" }),
  );

  const attempts: BinarySearchAttempt[] = [];
  let lowBytes = 0;
  let highBytes = 0;
  let converged = false;

  for (let i = 0; i < maxAttempts; i++) {
    const resp = await doStub.fetch(
      new Request("https://do/cap-binary-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // B7-R1 fix (2026-04-20): forward `samplesPerStep` into the DO so
        // each candidate size is actually sampled that many times
        // (fail-fast on any TOOBIG). Previously we sent only
        // `maxAttempts: 1` and the DO did 1 attempt, making the
        // "3 samples per step" caveat a misrepresentation of reality.
        body: JSON.stringify({ maxAttempts: 1, samplesPerStep }),
      }),
    );
    if (!resp.ok) {
      return makeIntegratedResult("V1-storage-DO-size-cap", start, {
        findingId: "spike-do-storage-F08",
        verdict: "still-open",
        success: false,
        mode: "live",
        usedPackages: [],
        caveats: [
          `DO responded ${resp.status} during bisection step ${i + 1}; binary-search could not converge`,
        ],
        observations: [{ label: "stepHttpStatus", value: resp.status }],
        errors: [
          {
            code: "do-http-error",
            message: `step ${i + 1} returned ${resp.status}`,
            count: 1,
          },
        ],
        evidenceRefs: [
          { kind: "source", locator: "spikes/round-2-integrated/spike-do-storage-r2/src/do/IntegratedProbeDO.ts" },
        ],
      });
    }
    const body = (await resp.json()) as BinarySearchResponse;
    lowBytes = body.lowBytes;
    highBytes = body.highBytes;
    if (body.attempts.length > attempts.length) {
      attempts.push(...body.attempts.slice(attempts.length));
    }
    if (body.widthBytes <= resolutionBytes) {
      converged = true;
      break;
    }
  }

  // B7 §5.4: each candidate size gets `samplesPerStep` independent
  // put/delete samples inside the DO (fail-fast on any SQLITE_TOOBIG).
  // B7-R1 fix (2026-04-20): verify the DO actually honoured our request
  // — every attempt should carry `samples: samplesPerStep`. Missing /
  // lower means the DO didn't implement the rubric and the caveat must
  // downgrade to "single-sample bisection".
  const allAttemptsHadRubricSamples = attempts.every(
    (a) => (a.samples ?? 1) >= samplesPerStep,
  );
  const minActualSamples =
    attempts.length > 0
      ? Math.min(...attempts.map((a) => a.samples ?? 1))
      : 0;

  const verdict = converged ? "writeback-shipped" : "still-open";
  const caveats = converged
    ? [
        `resolution ${resolutionBytes} bytes`,
        allAttemptsHadRubricSamples
          ? `samples per candidate size: ${samplesPerStep} (fail-fast on any SQLITE_TOOBIG)`
          : `target samples per step ${samplesPerStep}, but minimum observed was ${minActualSamples} — downgrade to "single-sample bisection"`,
      ]
    : [
        `binary-search did not converge within ${maxAttempts} steps`,
        "need more platform samples or higher maxAttempts",
      ];

  return makeIntegratedResult("V1-storage-DO-size-cap", start, {
    findingId: "spike-do-storage-F08",
    verdict,
    success: converged,
    mode: "live",
    usedPackages: [],
    caveats,
    observations: [
      { label: "lowBytes", value: lowBytes, unit: "bytes" },
      { label: "highBytes", value: highBytes, unit: "bytes" },
      { label: "widthBytes", value: highBytes - lowBytes, unit: "bytes" },
      { label: "converged", value: converged },
      { label: "attemptCount", value: attempts.length },
    ],
    errors: [],
    rawSamples: attempts,
    evidenceRefs: [
      { kind: "source", locator: "spikes/round-2-integrated/spike-do-storage-r2/src/do/IntegratedProbeDO.ts" },
      { kind: "finding-doc", locator: "docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md" },
    ],
    timings: { samplesN: attempts.length },
  });
}
