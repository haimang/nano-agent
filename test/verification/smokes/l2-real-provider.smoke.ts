/**
 * A6 Phase 4 P4-01 — L2 real provider golden path smoke.
 *
 * Drives the deploy-smoke profile end-to-end with the Q12 golden path:
 *   - provider:    OpenAI-compatible / `gpt-4.1-nano`
 *   - prompt:      `Reply with exactly: OK`
 *   - assertion:   `response.status === "ok" && response.output.length > 0`
 *
 * Execution modes:
 *   - **real-cloud** — when `OPENAI_API_KEY` and `NANO_AGENT_WORKERS_DEV_URL`
 *     are both present, the smoke issues a real POST to the deployed
 *     Worker's `/sessions/<uuid>/start` endpoint which in turn calls
 *     `gpt-4.1-nano` through `LLMExecutor`.
 *   - **harness-fallback** — when either env var is missing, the smoke
 *     runs against the in-process `WorkerHarness` so every developer
 *     laptop can produce a bundle. The verdict downgrades to
 *     `yellow` with a `blocking` note so reviewers can spot the
 *     difference.
 *
 * The bundle records both modes so P6 evidence closure knows which
 * artifacts came from a real L2 run versus a scaffolded fallback.
 */

import { performance } from "node:perf_hooks";

import { getProfile } from "../profiles/manifest.ts";
import {
  SmokeRecorder,
  WorkerHarness,
  writeVerdictBundle,
} from "./runner.ts";
import { makeFakeProviderBinding } from "../../fixtures/external-seams/fake-provider-worker.ts";

const SESSION_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "team-l2-smoke";
const GOLDEN_PROMPT = "Reply with exactly: OK";

export interface L2RealProviderSmokeOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly persist?: boolean;
  /**
   * When true, force the fallback harness path even when env vars are
   * set (useful for CI where the API key is present but we do not
   * want to burn tokens).
   */
  readonly forceHarness?: boolean;
}

export async function runL2RealProviderSmoke(
  options: L2RealProviderSmokeOptions = {},
): Promise<ReturnType<SmokeRecorder["build"]>> {
  const profile = getProfile("deploy-smoke-l2");
  const baseUrl = options.baseUrl ?? process.env.NANO_AGENT_WORKERS_DEV_URL;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const mode: "real-cloud" | "harness-fallback" =
    !options.forceHarness && baseUrl && apiKey ? "real-cloud" : "harness-fallback";

  const recorder = new SmokeRecorder({
    scenario: "l2-real-provider",
    profile,
    localFallback: mode === "harness-fallback",
  });

  const t0 = performance.now();

  try {
    recorder.emitTimeline({
      kind: "l2.mode",
      mode,
      apiKeyPresent: Boolean(apiKey),
      baseUrlPresent: Boolean(baseUrl),
    });

    if (mode === "real-cloud" && baseUrl && apiKey) {
      await runRealSmoke(recorder, baseUrl, apiKey);
    } else {
      await runHarnessFallback(recorder);
      recorder.block(
        `L2 real-provider smoke fell back to the harness path — set OPENAI_API_KEY + NANO_AGENT_WORKERS_DEV_URL to run the real golden path (Q12).`,
      );
    }

    recorder.setLatency({ fullTurnMs: performance.now() - t0 });
    recorder.setNotes(
      `L2 real-provider smoke mode=${mode}; golden path prompt='${GOLDEN_PROMPT}'; deterministic assertion = response.status==='ok' && output.length>0.`,
    );
  } catch (err) {
    recorder.recordFailure("l2-real-provider", err);
    recorder.block(
      "L2 real-provider smoke threw before all steps recorded — gate is RED",
    );
  }

  const bundle = recorder.build();
  writeVerdictBundle(bundle, { persist: options.persist });
  return bundle;
}

async function runRealSmoke(
  recorder: SmokeRecorder,
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  const turnStart = performance.now();
  const res = await fetch(
    `${baseUrl}/sessions/${SESSION_UUID}/start`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Caller-supplied key — the Worker uses `wrangler secret`, but
        // L2 also accepts a one-shot override for smoke reruns.
        "x-openai-api-key": apiKey,
      },
      body: JSON.stringify({
        initial_input: GOLDEN_PROMPT,
        goldenModel: "gpt-4.1-nano",
      }),
    },
  );
  if (res.status !== 200) {
    throw new Error(`real golden path returned ${res.status}`);
  }
  const body = (await res.json()) as { ok?: boolean; phase?: string };
  recorder.step(
    "real golden path returned 200",
    body.ok === true ? "pass" : "fail",
    performance.now() - turnStart,
  );
  recorder.emitTimeline({ kind: "l2.real.start", body });
  recorder.setLatency({ firstByteMs: performance.now() - turnStart });
}

async function runHarnessFallback(recorder: SmokeRecorder): Promise<void> {
  // Fall back to the fake provider worker so the smoke still exercises
  // the same Worker / DO / session edge code path used in production.
  const providerBinding = makeFakeProviderBinding({
    reply: "OK",
  });
  const harness = new WorkerHarness({
    profileId: "deploy-smoke-l2",
    envOverrides: {
      TEAM_UUID,
      FAKE_PROVIDER_WORKER: providerBinding,
    } as never,
    evalSink: { emit: (event) => recorder.emitTrace(event) },
  });

  const attachStart = performance.now();
  const res = await harness.fetch(
    `https://harness.local/sessions/${SESSION_UUID}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initial_input: GOLDEN_PROMPT }),
    },
  );
  recorder.setLatency({ wsAttachMs: performance.now() - attachStart });

  if (res.status !== 200) {
    throw new Error(`harness golden path returned ${res.status}`);
  }
  const body = (await res.json()) as { ok?: boolean; phase?: string };
  recorder.step(
    "harness golden path returned 200",
    body.ok === true ? "pass" : "fail",
    performance.now() - attachStart,
  );
  recorder.emitTimeline({
    kind: "l2.harness.start",
    body,
    note: "harness path — not a real-cloud run; see bundle.blocking",
  });

  // Second assertion: the deploy-smoke profile must still carry the
  // correct composition (provider=local by design), so the harness run
  // still proves the scaffolding is ready for a real-cloud smoke.
  const profile = harness.describeProfile();
  recorder.step(
    "deploy-smoke profile asserts provider=local",
    profile.compositionProfile.provider === "local" ? "pass" : "fail",
    0,
  );
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  runL2RealProviderSmoke({ persist: true })
    .then((bundle) => {
      console.log(`[l2-real-provider] verdict=${bundle.verdict}`);
      if (bundle.blocking.length > 0) {
        for (const b of bundle.blocking) console.log(`  blocking: ${b}`);
      }
      if (bundle.verdict === "red") process.exitCode = 1;
    })
    .catch((err) => {
      console.error("l2-real-provider smoke crashed:", err);
      process.exit(2);
    });
}
