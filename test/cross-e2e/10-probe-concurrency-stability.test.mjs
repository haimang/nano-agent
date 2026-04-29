import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

/**
 * Cross e2e — orchestrator-core public facade probe fan-out under concurrent load.
 *
 * ZX3 P4-04 / R30 fix(2026-04-27): ZX2 P1-02 set 5 leaf workers'
 * `workers_dev: false`. Only orchestrator-core has a public workers.dev URL.
 * Pre-ZX3 this test fanned out 48 concurrent probes across all 6 workers'
 * public URLs, but 5 of them are now unreachable.  Post-ZX3: fan-out 48
 * probes against the orchestrator-core public facade only — that's still
 * the right concurrency stress test for the public entry under load.
 *
 * Passing criteria:
 *   - all 48 responses 200
 *   - response bodies are identical(deep-equal canonical probe fields)
 *   - no request takes > 10s(timeout guard for cold-start pathology)
 */

const FANOUT = 48;
const TIMEOUT_MS = 20_000;

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
  "orchestrator-core facade 48 concurrent probes stay identical-body and under 10s",
  ["orchestrator-core"],
  async ({ getUrl }) => {
    const base = getUrl("orchestrator-core");
    const warmup = await fetchJson(`${base}/`);
    assert.equal(warmup.response.status, 200, "warmup probe must succeed before fan-out");
    const started = Date.now();
    const probes = Array.from({ length: FANOUT }, (_, i) => {
      const label = `orchestrator-core#${i}`;
      return withTimeout(fetchJson(`${base}/`), TIMEOUT_MS, label).then(
        (result) => ({ label, ...result }),
      );
    });
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

    // Body identity: canonical probe fields must match across the fan-out
    const first = results[0].json;
    assert.ok(first, "first probe has JSON body");
    for (const r of results.slice(1)) {
      assert.deepEqual(r.json?.worker, first.worker, `${r.label} worker field drift`);
      assert.deepEqual(r.json?.phase, first.phase, `${r.label} phase field drift`);
      assert.deepEqual(
        r.json?.public_facade,
        first.public_facade,
        `${r.label} public_facade drift`,
      );
    }

    assert.ok(
      elapsed < TIMEOUT_MS,
      `${FANOUT} concurrent probes took ${elapsed}ms (>${TIMEOUT_MS}ms — suspect serialization or cold-start pathology)`,
    );
  },
);
