/**
 * A6 Phase 3 P3-01 — L1 session edge dry-run smoke.
 *
 * Drives the deploy-shaped session edge through:
 *   1. `session.start` POST (HTTP fallback)
 *   2. `status` GET → expect actor at `attached`
 *   3. `session.followup_input` POST (Phase 0 widened ingress)
 *   4. `session.cancel` POST → ingress accepts, actor settles back
 *   5. WS upgrade GET → 101 (or 200 in node test harness)
 *
 * Designed to run in two modes:
 *   - against a real `wrangler dev --remote` baseUrl when the env var
 *     `NANO_AGENT_WRANGLER_DEV_URL` is set,
 *   - otherwise against the in-process WorkerHarness fallback so
 *     reviewers can exercise the same spec on a developer laptop.
 *
 * The bundle records `profileLadder = local-l0-harness` in the second
 * mode so reviewers cannot mistake a fallback run for a real L1.
 */

import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { getProfile } from "../profiles/manifest.ts";
import {
  SmokeRecorder,
  WorkerHarness,
  writeVerdictBundle,
} from "./runner.ts";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const TEAM_UUID = "team-l1-smoke";

export interface L1SessionEdgeSmokeOptions {
  readonly baseUrl?: string;
  readonly persist?: boolean;
}

/** Run the L1 session edge smoke. Returns the produced verdict bundle. */
export async function runL1SessionEdgeSmoke(
  options: L1SessionEdgeSmokeOptions = {},
): Promise<ReturnType<SmokeRecorder["build"]>> {
  const profile = getProfile("remote-dev-l1");
  const recorder = new SmokeRecorder({
    scenario: "l1-session-edge",
    profile,
    localFallback: options.baseUrl === undefined,
  });

  const harness = new WorkerHarness({
    profileId: "remote-dev-l1",
    baseUrl: options.baseUrl,
    envOverrides: { TEAM_UUID } as never,
    evalSink: { emit: (event) => recorder.emitTrace(event) },
  });

  const base = options.baseUrl ?? "https://harness.local";
  const t0 = performance.now();

  try {
    // Step 1 — session.start via HTTP fallback. The smoke posts the
    // same envelope shape an HTTP-only client would.
    await recorder.timed("session.start (http fallback)", async () => {
      const res = await harness.fetch(
        `${base}/sessions/${SESSION_UUID}/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initial_input: "L1 smoke first turn" }),
        },
      );
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status}`);
      }
      const body = await res.json();
      recorder.emitTimeline({ kind: "session.start.ack", body });
    });

    // Step 2 — status GET reflects the real actor phase.
    const phase = await recorder.timed("status reflects actor phase", async () => {
      const res = await harness.fetch(
        `${base}/sessions/${SESSION_UUID}/status`,
      );
      const body = (await res.json()) as { phase: string };
      if (!["attached", "turn_running"].includes(body.phase)) {
        throw new Error(`unexpected phase: ${body.phase}`);
      }
      recorder.emitTimeline({ kind: "session.status", body });
      return body.phase;
    });

    // Step 3 — session.followup_input is admitted (Phase 0 widened ingress).
    await recorder.timed("session.followup_input via http fallback", async () => {
      const res = await harness.fetch(
        `${base}/sessions/${SESSION_UUID}/input`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "L1 smoke follow-up turn" }),
        },
      );
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status}`);
      }
      recorder.emitTimeline({ kind: "session.followup.ack" });
    });

    // Step 4 — cancel.
    await recorder.timed("session.cancel", async () => {
      const res = await harness.fetch(
        `${base}/sessions/${SESSION_UUID}/cancel`,
        { method: "POST" },
      );
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status}`);
      }
      recorder.emitTimeline({ kind: "session.cancel.ack" });
    });

    // Step 5 — WS upgrade attempt. In node-harness mode the upgrade
    // returns 200 (no real WebSocketPair); the smoke records both.
    await recorder.timed("ws upgrade", async () => {
      const res = await harness.fetch(
        `${base}/sessions/${SESSION_UUID}/ws`,
        { headers: { upgrade: "websocket" } },
      );
      if (![101, 200].includes(res.status)) {
        throw new Error(`expected 101/200, got ${res.status}`);
      }
      recorder.emitTimeline({
        kind: "ws.upgrade.ack",
        status: res.status,
        modeHint:
          res.status === 101 ? "real-ws" : "node-harness-acknowledgment",
      });
    });

    recorder.setLatency({ fullTurnMs: performance.now() - t0 });
    recorder.setNotes(
      `L1 session-edge smoke completed against profile ${profile.id}; final phase=${phase}; localFallback=${harness.localFallback}.`,
    );
  } catch (err) {
    recorder.recordFailure("l1-session-edge", err, {
      phase: "smoke top-level",
    });
    recorder.block(
      "L1 session-edge smoke aborted before all steps recorded — gate is RED",
    );
  }

  const bundle = recorder.build();
  writeVerdictBundle(bundle, { persist: options.persist });
  return bundle;
}

// ── CLI entrypoint ──────────────────────────────────────────────────

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const baseUrl = process.env.NANO_AGENT_WRANGLER_DEV_URL;
  runL1SessionEdgeSmoke({ baseUrl, persist: true })
    .then((bundle) => {
      const path = fileURLToPath(new URL(import.meta.url));
      console.log(`[l1-session-edge] verdict=${bundle.verdict}`);
      console.log(`[l1-session-edge] passes=${bundle.summary.passes} failures=${bundle.summary.failures}`);
      console.log(`[l1-session-edge] entry=${path}`);
      if (bundle.verdict === "red") process.exitCode = 1;
    })
    .catch((err) => {
      console.error("l1-session-edge smoke crashed:", err);
      process.exit(2);
    });
}
