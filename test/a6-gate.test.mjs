/**
 * A6 Phase 5 — Gate aggregator test.
 *
 * Pins the `runGate()` verdict composition under local review
 * conditions (no real cloud secrets). The expected state is:
 *
 *   - L1 session-edge    : green
 *   - L1 external-seams  : green
 *   - L2 real-provider   : red (harness fallback emits blocker)
 *   - gate verdict       : red (one required scenario is red)
 *
 * The blocker message must clearly call out the missing env vars so
 * reviewers immediately know how to promote the gate to green.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runGate } from "./verification/smokes/gate.ts";

test("runGate aggregates L1 + L2 smokes into a single verdict under local review", async () => {
  const gate = await runGate({ persist: false });
  assert.equal(gate.bundleVersion, 1);
  assert.equal(
    gate.requirementSummary["l1-session-edge"],
    "green",
    "L1 session edge smoke must be green against the harness",
  );
  assert.equal(
    gate.requirementSummary["l1-external-seams"],
    "green",
    "L1 external seams smoke must be green against the fake workers",
  );
  assert.equal(
    gate.requirementSummary["l2-real-provider"],
    "red",
    "L2 real-provider smoke should be red when the fallback path emits the blocker",
  );
  assert.equal(gate.verdict, "red");
  assert.ok(
    gate.blocking.some((b) => b.includes("OPENAI_API_KEY")),
    "blocking list must mention the missing env var so reviewers can promote to green",
  );
});

test("runGate can persist a gate bundle without crashing when dir is missing", async () => {
  // `persist: false` by default so the test does not create artefacts
  // in the real verdict-bundles directory. This assertion just confirms
  // that the shape is stable for CI integration.
  const gate = await runGate({ persist: false });
  assert.ok(Array.isArray(gate.blocking));
  assert.ok(typeof gate.perScenario["l1-session-edge"].verdict === "string");
});
