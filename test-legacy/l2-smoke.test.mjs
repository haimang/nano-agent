/**
 * A6 Phase 4 — L2 real-provider smoke wrapper test.
 *
 * In the local review environment neither `OPENAI_API_KEY` nor
 * `NANO_AGENT_WORKERS_DEV_URL` is set, so the smoke intentionally
 * falls back to the in-process harness and records a `yellow` verdict
 * with a blocking note. This test pins that behaviour so a future
 * regression (e.g. silent fallback escalated to green) is caught
 * immediately.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runL2RealProviderSmoke } from "./verification/smokes/l2-real-provider.smoke.ts";

test("L2 smoke falls back to the harness and records the blocker when real secrets are absent", async () => {
  const bundle = await runL2RealProviderSmoke({
    persist: false,
    forceHarness: true,
  });
  // Harness fallback is always RED verdict because the blocker is
  // present (see runner.computeVerdict — blocking forces red).
  assert.equal(bundle.verdict, "red");
  assert.equal(bundle.blocking.length, 1);
  assert.ok(
    bundle.blocking[0].includes("OPENAI_API_KEY"),
    "blocker must call out the missing env vars",
  );
  assert.equal(bundle.profileLadder, "local-l0-harness");
  assert.ok(
    bundle.steps.find((s) => s.name.includes("harness golden path")),
  );
});
