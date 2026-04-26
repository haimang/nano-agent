import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

/**
 * Cross e2e — 6-worker probe fan-out under concurrent load.
 *
 * Stack-preview-inventory (01) probes each worker once. This test
 * fans out **8 concurrent probes per worker** to catch:
 *   - cold-start DO race conditions (worker-wakeup under load)
 *   - Cloudflare edge caching drift (identical probes must return
 *     identical JSON body — phase / absorbed_runtime / worker name)
 *   - session namespace independence: the probe path is session-less
 *     (`GET /`), so concurrent probes MUST NOT interfere with each
 *     other or leak state between workers
 *   - subrequest budget health at the edge (48 concurrent requests
 *     total across 6 workers)
 *
 * Passing criteria:
 *   - all 48 responses 200
 *   - response bodies are identical per worker (deep-equal)
 *   - no request takes > 10s(timeout guard for cold-start pathology)
 */

const WORKERS = [
  "agent-core",
  "orchestrator-auth",
  "orchestrator-core",
  "bash-core",
  "context-core",
  "filesystem-core",
];
const FANOUT = 8;
const TIMEOUT_MS = 10_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`timeout after ${ms}ms: ${label}`)),
        ms,
      ),
    ),
  ]);
}

liveTest(
  "6-worker probe fan-out (8×6=48 concurrent) stays identical-body and under 10s",
  WORKERS,
  async ({ getUrl }) => {
    const started = Date.now();
    const probes = WORKERS.flatMap((worker) =>
      Array.from({ length: FANOUT }, (_, i) => {
        const label = `${worker}#${i}`;
        return withTimeout(
          fetchJson(`${getUrl(worker)}/`),
          TIMEOUT_MS,
          label,
        ).then((result) => ({ worker, label, ...result }));
      }),
    );
    const results = await Promise.all(probes);
    const elapsed = Date.now() - started;

    // All 48 must return 200
    for (const r of results) {
      assert.equal(
        r.response.status,
        200,
        `${r.label} non-200 status: ${r.response.status}`,
      );
    }

    // Per-worker body identity: canonical probe fields must match
    // across the 8 fan-out calls
    for (const worker of WORKERS) {
      const group = results.filter((r) => r.worker === worker);
      assert.equal(group.length, FANOUT);
      const first = group[0].json;
      assert.ok(first, `${worker} first probe has JSON body`);
      for (const r of group.slice(1)) {
        assert.deepEqual(
          r.json?.worker,
          first.worker,
          `${r.label} worker field drift`,
        );
        assert.deepEqual(
          r.json?.phase,
          first.phase,
          `${r.label} phase field drift`,
        );
        assert.deepEqual(
          r.json?.absorbed_runtime,
          first.absorbed_runtime,
          `${r.label} absorbed_runtime drift`,
        );
      }
    }

    // Sanity: 48 probes should not take the full 10s × 48 — they run
    // concurrently; if the wall clock exceeds 10s it suggests cold-start
    // pathology or serialization.
    assert.ok(
      elapsed < TIMEOUT_MS,
      `48 concurrent probes took ${elapsed}ms (>${TIMEOUT_MS}ms — suspect serialization or cold-start pathology)`,
    );
  },
);
