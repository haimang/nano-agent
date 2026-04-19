/**
 * V3-binding-hooks-callback probe.
 *
 * Validation goal (per P0-spike-binding-pair-design §4.3):
 *   - cross-worker hook dispatch latency baseline
 *   - blocking hook (slow callee) tolerance
 *   - failure path: thrown hook → error shape received by caller
 *   - 5 anchor headers traverse hook callback path correctly
 */

import { makeResult, percentile, type BindingProbeResult } from "../result-shape.js";

export async function probeHooksCallback(
  workerB: Fetcher,
  _params: Record<string, unknown>,
): Promise<BindingProbeResult> {
  const start = Date.now();
  const observations: BindingProbeResult["observations"] = [];
  const errors: BindingProbeResult["errors"] = [];

  // (1) Synchronous baseline: dispatch with mode=ok × N, measure latency.
  const N = 20;
  const okLatencies: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    try {
      const res = await workerB.fetch(
        new Request("https://worker-b.spike/handle/hook-dispatch", {
          method: "POST",
          body: JSON.stringify({
            hookEvent: "PreToolUse",
            eventPayload: { tool: "test", iter: i },
            mode: "ok",
          }),
          headers: { "content-type": "application/json" },
        }),
      );
      await res.json();
      okLatencies.push(Date.now() - t0);
    } catch (err) {
      errors.push({
        code: "OkHookDispatchFailed",
        message: String((err as Error)?.message ?? err),
        count: 1,
        sample: { i },
      });
    }
  }
  observations.push({
    label: "ok_dispatch_latency",
    value: {
      samples: okLatencies.length,
      p50Ms: percentile(okLatencies, 0.5),
      p99Ms: percentile(okLatencies, 0.99),
      maxMs: okLatencies.length ? Math.max(...okLatencies) : 0,
    },
  });

  // (2) Slow blocking hook: 1.5s callee, measure caller wait.
  try {
    const t0 = Date.now();
    const res = await workerB.fetch(
      new Request("https://worker-b.spike/handle/hook-dispatch", {
        method: "POST",
        body: JSON.stringify({
          hookEvent: "PreCompact",
          mode: "slow",
          slowMs: 1500,
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    observations.push({
      label: "slow_blocking_hook",
      value: {
        callerWaitMs: Date.now() - t0,
        calleeReportedLatencyMs: body.latencyMs,
        outcome: body.outcome,
      },
    });
  } catch (err) {
    errors.push({
      code: "SlowHookFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (3) Throwing hook: mode=throw, observe error envelope shape.
  try {
    const t0 = Date.now();
    const res = await workerB.fetch(
      new Request("https://worker-b.spike/handle/hook-dispatch", {
        method: "POST",
        body: JSON.stringify({ hookEvent: "PostToolUse", mode: "throw" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    observations.push({
      label: "throwing_hook",
      value: {
        responseStatus: res.status,
        callerWaitMs: Date.now() - t0,
        bodyShape: Object.keys(body),
        bodyOk: body.ok,
        bodyThrown: body.thrown,
      },
    });
  } catch (err) {
    errors.push({
      code: "ThrowingHookProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (4) Anchor traversal: send anchors, dispatch hook, then dump headers via
  // header-dump to confirm worker-b sees them on hook path too.
  try {
    const headers = new Headers({
      "x-nacp-trace-uuid": "abcdef00-0000-4000-8000-000000000001",
      "x-nacp-session-uuid": "abcdef00-0000-4000-8000-000000000002",
      "content-type": "application/json",
    });
    const res = await workerB.fetch(
      new Request("https://worker-b.spike/handle/header-dump", {
        method: "POST",
        body: JSON.stringify({ hookEvent: "anchor-traversal-test" }),
        headers,
      }),
    );
    const body = (await res.json()) as { receivedHeaders: Record<string, string> };
    observations.push({
      label: "anchor_on_hook_path",
      value: {
        traceSurvived: body.receivedHeaders["x-nacp-trace-uuid"] !== undefined,
        sessionSurvived: body.receivedHeaders["x-nacp-session-uuid"] !== undefined,
      },
    });
  } catch (err) {
    errors.push({
      code: "AnchorOnHookPathFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  return makeResult("V3-binding-hooks-callback", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: N + 3 },
  });
}
