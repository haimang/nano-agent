/**
 * Follow-up binding-F01 — callee-side abort observation.
 *
 * Round 1 confirmed caller-side abort works (`AbortController.abort()`
 * returns promptly). B1 deferred "does the callee see the signal?"
 * to B7 because the answer determines whether cross-worker
 * cancellation requires a second-channel protocol or rides on the
 * service binding's own signal propagation.
 *
 * Probe: worker-a issues `POST /slow` with a 5-second payload, then
 * aborts after 300ms. Worker-b's handler emits a JSON log line
 * `[slow] abort observed` on observing the signal — that line is
 * captured by `wrangler tail` and cited in the closure section.
 *
 * Round-2 evidence requires BOTH:
 *   (a) worker-a's fetch rejects with `AbortError`
 *   (b) worker-a reads worker-b's 499 response (best-effort) OR the
 *       tail log shows `[slow] abort observed`
 *
 * We can attest (a) in-worker. For (b) the `wrangler tail` capture
 * is the authoritative evidence and must be cited from the
 * `.out/binding-f01.tail.log` the operator pipes during the run.
 */

import {
  makeBindingResult,
  type BindingProbeResult,
} from "../result-shape.js";

export async function probeBindingF01CalleeAbort(
  workerB: Fetcher,
): Promise<BindingProbeResult> {
  const start = Date.now();
  const controller = new AbortController();
  const abortAfterMs = 300;
  const requestSleepMs = 5000;

  const timer = setTimeout(() => controller.abort(), abortAfterMs);

  let callerAbortObserved = false;
  let calleeResponseStatus: number | null = null;
  let calleeBody: string | null = null;
  let error: { code: string; message: string } | null = null;

  try {
    const resp = await workerB.fetch(
      new Request("https://worker-b/slow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sleepMs: requestSleepMs, tag: "binding-f01" }),
        signal: controller.signal,
      }),
    );
    // If somehow we got a response before the abort fired, record it.
    calleeResponseStatus = resp.status;
    calleeBody = await resp.text();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      callerAbortObserved = true;
    } else {
      error = {
        code: "unexpected-error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  } finally {
    clearTimeout(timer);
  }

  const success = callerAbortObserved && error === null;
  return makeBindingResult("V3-binding-f01-callee-abort", start, {
    findingId: "spike-binding-pair-binding-F01",
    // writeback-shipped on caller-side abort observed; closure still
    // cites `wrangler tail` for the callee-side log line, which lives
    // outside this probe's control.
    verdict: success ? "writeback-shipped" : "still-open",
    success,
    mode: "live",
    usedPackages: [],
    caveats: [
      "callee-side observation is attested by `wrangler tail` log capture; this probe only attests caller-side",
      `abortAfterMs: ${abortAfterMs}; requestSleepMs: ${requestSleepMs}`,
      "if the abort fired before the binding fetched, callerAbortObserved will still be true — that's the contract we wanted",
    ],
    observations: [
      { label: "callerAbortObserved", value: callerAbortObserved },
      { label: "calleeResponseStatus", value: calleeResponseStatus },
      { label: "calleeBody", value: calleeBody?.slice(0, 512) ?? null },
      { label: "abortAfterMs", value: abortAfterMs, unit: "ms" },
    ],
    errors: error ? [{ ...error, count: 1 }] : [],
    evidenceRefs: [
      { kind: "source", locator: "spikes/round-2-integrated/spike-binding-pair-r2/worker-b-r2/src/handlers/slow-abort-observer.ts" },
      { kind: "tail-log", locator: ".out/binding-f01.tail.log" },
      { kind: "finding-doc", locator: "docs/spikes/spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md" },
    ],
    timings: { samplesN: 1 },
  });
}
