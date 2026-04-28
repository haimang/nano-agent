import assert from "node:assert/strict";
import { liveTest, liveEnabled } from "../shared/live.mjs";
import test from "node:test";

// ZX3 P4-04 / R30(2026-04-27): pre-ZX3 this test directly probed
// `context-core/runtime` and `filesystem-core/runtime` via their public
// workers.dev URLs to assert library-only posture. ZX2 P1-02 set both to
// `workers_dev: false` — the assertion that a `/runtime` POST returns 404
// is now enforced by the worker's own internal tests + binding-scope guard
// (verified in worker test suites). Direct probe via public URL is no
// longer the right enforcement vehicle.

// This file is preserved as a marker that the contract still holds — it is
// asserted by:
//   - workers/context-core test suite (binding-scope-forbidden 401 / route 404)
//   - workers/filesystem-core test suite (same)
//   - 6-worker matrix wrangler.jsonc audit in test/root-guardians/

if (liveEnabled()) {
  test("library worker topology: context-core + filesystem-core stay probe-only(asserted in worker tests + wrangler audit)", () => {
    assert.ok(true, "covered by worker-local tests + root-guardians wrangler audit; no public URL probe in ZX3 topology");
  });
}
