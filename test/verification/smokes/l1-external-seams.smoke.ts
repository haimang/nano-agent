/**
 * A6 Phase 3 P3-02 — L1 external seam dry-run smoke.
 *
 * Drives the three v1 binding-catalog seams against their fake worker
 * fixtures via the same adapter code the deployed Session DO uses.
 * Proves that:
 *   - `makeHookTransport` → fake-hook-worker round trip returns the
 *     schema-compliant `hook.outcome` body.
 *   - `makeCapabilityTransport` → fake-capability-worker round trip
 *     returns a `tool.call.response` body and the cancel endpoint
 *     acks cleanly.
 *   - `makeProviderFetcher` → fake-provider-worker `/chat/completions`
 *     returns an SSE stream ending with `[DONE]`.
 *
 * Every success / failure is emitted into the verdict bundle so
 * reviewers can read a single artifact to understand the L1 verdict.
 */

import { performance } from "node:perf_hooks";

import {
  makeCapabilityTransport,
  makeHookTransport,
  makeProviderFetcher,
} from "../../../packages/session-do-runtime/dist/index.js";
import {
  fakeCapabilityFetch,
  makeFakeCapabilityBinding,
} from "../../fixtures/external-seams/fake-capability-worker.ts";
import {
  fakeHookFetch,
  makeFakeHookBinding,
} from "../../fixtures/external-seams/fake-hook-worker.ts";
import {
  fakeProviderFetch,
  makeFakeProviderBinding,
} from "../../fixtures/external-seams/fake-provider-worker.ts";

import { getProfile } from "../profiles/manifest.ts";
import { SmokeRecorder, writeVerdictBundle } from "./runner.ts";

export interface L1ExternalSeamsSmokeOptions {
  readonly persist?: boolean;
}

const TRACE_UUID = "11111111-1111-4111-8111-111111111111";

/** Run the L1 external seams smoke. Returns the produced verdict bundle. */
export async function runL1ExternalSeamsSmoke(
  options: L1ExternalSeamsSmokeOptions = {},
): Promise<ReturnType<SmokeRecorder["build"]>> {
  // Prefer cross-referencing live fake-*-fetch symbols so type checker
  // catches any fixture drift (they are only used for import safety).
  void fakeHookFetch;
  void fakeCapabilityFetch;
  void fakeProviderFetch;

  const profile = getProfile("remote-dev-l1");
  const recorder = new SmokeRecorder({
    scenario: "l1-external-seams",
    profile,
    localFallback: true, // seam transports are wired against in-process fake bindings
  });

  const hookBinding = makeFakeHookBinding();
  const capabilityBinding = makeFakeCapabilityBinding();
  const providerBinding = makeFakeProviderBinding();

  const hookTransport = makeHookTransport(hookBinding);
  const capabilityTransport = makeCapabilityTransport(capabilityBinding);
  const providerFetcher = makeProviderFetcher(providerBinding);

  const t0 = performance.now();

  try {
    if (!hookTransport || !capabilityTransport || !providerFetcher) {
      throw new Error("binding adapters returned undefined for wired fixtures");
    }

    // Step 1 — hook seam round trip.
    const hookStart = performance.now();
    const hookResult = (await hookTransport.call({
      handler: { id: "h-smoke", event: "PreToolUse" },
      emitBody: {
        event_name: "PreToolUse",
        event_payload: { tool_name: "bash" },
      },
      context: { traceUuid: TRACE_UUID },
    })) as { body: { ok: boolean } };
    recorder.step(
      "hook seam round trip",
      hookResult.body.ok === true ? "pass" : "fail",
      performance.now() - hookStart,
    );
    recorder.emitTimeline({ kind: "seam.hook.outcome", body: hookResult });

    // Step 2 — capability seam call + cancel.
    const capStart = performance.now();
    const capResponse = (await capabilityTransport.call({
      requestId: "req-l1",
      capabilityName: "grep",
      body: { tool_name: "grep", tool_input: { pattern: "x" } },
    })) as { status: string; output: string };
    await capabilityTransport.cancel!({
      requestId: "req-l1",
      body: { reason: "smoke" },
    });
    recorder.step(
      "capability seam call + cancel",
      capResponse.status === "ok" ? "pass" : "fail",
      performance.now() - capStart,
    );
    recorder.emitTimeline({ kind: "seam.capability.response", body: capResponse });

    // Step 3 — provider seam SSE smoke.
    const provStart = performance.now();
    const providerRes = await providerFetcher(
      "https://fake-provider.local/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-fake-1",
          messages: [{ role: "user", content: "Reply with OK" }],
          stream: true,
        }),
      },
    );
    const providerText = await providerRes.text();
    recorder.step(
      "fake provider SSE",
      providerRes.status === 200 && providerText.includes("[DONE]")
        ? "pass"
        : "fail",
      performance.now() - provStart,
    );
    recorder.emitTimeline({
      kind: "seam.provider.sse",
      status: providerRes.status,
      bytes: providerText.length,
    });

    recorder.setLatency({ fullTurnMs: performance.now() - t0 });
    recorder.setNotes(
      "L1 external seams smoke — hook + capability + fake provider all round-tripped.",
    );
  } catch (err) {
    recorder.recordFailure("l1-external-seams", err, {
      phase: "smoke top-level",
    });
    recorder.block(
      "L1 external-seams smoke aborted — one of the v1 binding catalog seams failed",
    );
  }

  const bundle = recorder.build();
  writeVerdictBundle(bundle, { persist: options.persist });
  return bundle;
}

// ── CLI entrypoint ──────────────────────────────────────────────────

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  runL1ExternalSeamsSmoke({ persist: true })
    .then((bundle) => {
      console.log(`[l1-external-seams] verdict=${bundle.verdict}`);
      console.log(
        `[l1-external-seams] passes=${bundle.summary.passes} failures=${bundle.summary.failures}`,
      );
      if (bundle.verdict === "red") process.exitCode = 1;
    })
    .catch((err) => {
      console.error("l1-external-seams smoke crashed:", err);
      process.exit(2);
    });
}
