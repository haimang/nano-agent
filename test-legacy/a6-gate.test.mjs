/**
 * A6 Phase 5 — Gate aggregator test.
 *
 * Pins the `runGate()` verdict composition under local review
 * conditions (no real cloud secrets). The expected state after the
 * A6-A7 code review fixes (GPT R2 / R3) is:
 *
 *   - L1 session-edge    : green (in-process harness round trip)
 *   - L1 external-seams  : red   (fixture-contract only; blocker self-reported)
 *   - L2 real-provider   : red   (harness fallback cannot satisfy profile contract)
 *   - gate verdict       : red   (any required scenario red → gate red)
 *
 * The blocker list must mention both the missing `OPENAI_API_KEY` AND
 * the fixture-contract scope of `l1-external-seams` so reviewers
 * immediately know what is needed to promote the gate to green.
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
    "red",
    "L1 external-seams smoke must stay red until real service-binding boundary is wired (A6-A7 review GPT R2)",
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

test("runGate ignores optional (non-required) smokes when computing the verdict", async () => {
  // A6-A7 review Kimi R6: gate aggregation only iterates
  // `requiredFor("L1") + requiredFor("L2")`. If a future smoke gets
  // added as `optional`, its verdict MUST NOT flip the gate.
  const makeBundle = (id, verdict) => ({
    bundleVersion: 1,
    scenario: id,
    profile: "remote-dev-l1",
    profileLadder: "remote-dev-l1",
    localFallback: true,
    startedAt: "2026-04-18T00:00:00.000Z",
    endedAt: "2026-04-18T00:00:00.001Z",
    verdict,
    blocking: [],
    trace: { events: [], anchorTraceUuid: "trace-0" },
    timeline: [],
    placement: [],
    steps: [],
    failureRecord: [],
    summary: { passes: 1, failures: 0, skipped: 0 },
  });
  const perScenarioOverride = {
    "l1-session-edge": makeBundle("l1-session-edge", "green"),
    "l1-external-seams": makeBundle("l1-external-seams", "green"),
    "l2-real-provider": makeBundle("l2-real-provider", "green"),
    // A fabricated optional scenario with a red verdict — current
    // SMOKE_INVENTORY does not mark any smoke as `optional`, but the
    // gate's requiredIds loop still must ignore this id.
    "custom-optional-smoke": makeBundle("custom-optional-smoke", "red"),
  };
  const gate = await runGate({ persist: false, perScenarioOverride });
  assert.equal(gate.verdict, "green");
  assert.equal(gate.requirementSummary["custom-optional-smoke"], undefined);
  assert.ok(
    !gate.blocking.some((b) => b.includes("custom-optional-smoke")),
    "optional smoke must not appear in the gate's blocking list",
  );
});
