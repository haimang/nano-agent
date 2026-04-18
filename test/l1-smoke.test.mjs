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

test("L1 external seams smoke runs green against the fake worker fixtures", async () => {
  const bundle = await runL1ExternalSeamsSmoke({ persist: false });
  if (bundle.verdict !== "green") {
    console.error("L1 external-seams bundle:", JSON.stringify(bundle, null, 2));
  }
  assert.equal(bundle.verdict, "green");
  assert.equal(bundle.summary.failures, 0);
  // All three seams must be reflected.
  const stepNames = bundle.steps.map((s) => s.name);
  assert.ok(stepNames.includes("hook seam round trip"));
  assert.ok(stepNames.includes("capability seam call + cancel"));
  assert.ok(stepNames.includes("fake provider SSE"));
});
