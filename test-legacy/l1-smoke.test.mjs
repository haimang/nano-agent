/**
 * A6 Phase 3 — L1 smoke wrapper tests.
 *
 * Executes the L1 session-edge and external-seam smokes against the
 * in-process `WorkerHarness` fallback (no wrangler required) and
 * asserts that each produces a `green` verdict bundle. The same smoke
 * modules are invoked by the Phase 5 gate script when a real
 * `NANO_AGENT_WRANGLER_DEV_URL` is set — both paths share the verdict
 * shape.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runL1SessionEdgeSmoke } from "./verification/smokes/l1-session-edge.smoke.ts";
import { runL1ExternalSeamsSmoke } from "./verification/smokes/l1-external-seams.smoke.ts";

test("L1 session edge smoke runs green against the in-process harness", async () => {
  const bundle = await runL1SessionEdgeSmoke({ persist: false });
  if (bundle.verdict !== "green") {
    console.error("L1 session-edge bundle:", JSON.stringify(bundle, null, 2));
  }
  assert.equal(bundle.verdict, "green");
  assert.ok(bundle.summary.passes >= 5);
  assert.equal(bundle.summary.failures, 0);
  assert.equal(bundle.profileLadder, "local-l0-harness");
});

test("L1 external seams smoke passes fixture-contract assertions but is blocked from L1 grade", async () => {
  // A6-A7 review GPT R2: this smoke exercises in-process fake bindings
  // only; the smoke now self-reports a blocker so the verdict is `red`
  // until companion `wranglers/{fake-*}` workers are stood up. The
  // assertions below still require the three seam round-trips to pass
  // (no regression in the fixture contract itself).
  const bundle = await runL1ExternalSeamsSmoke({ persist: false });
  assert.equal(bundle.verdict, "red", "must advertise blocker until real service-binding boundary is wired");
  assert.ok(
    bundle.blocking.some((msg) => msg.includes("fixture-contract only")),
    "blocker string must name the fixture-contract scope",
  );
  // Fixture round-trips themselves must still succeed.
  assert.equal(bundle.summary.failures, 0);
  const stepNames = bundle.steps.map((s) => s.name);
  assert.ok(stepNames.includes("hook seam round trip"));
  assert.ok(stepNames.includes("capability seam call + cancel"));
  assert.ok(stepNames.includes("fake provider SSE"));
});
