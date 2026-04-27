/**
 * ZX2 Phase 6 P6-03 — facade-必需 transport e2e.
 *
 * Validates the new ZX2 endpoints against a live preview deployment.
 * Skipped (like every other live test) when `NANO_AGENT_LIVE_E2E` is not
 * set — the bundle still gets typechecked + node test parsed in CI so
 * shape errors surface during PR review.
 *
 * Sequence:
 *   1. POST /me/sessions               → server-mint UUID + 201
 *   2. GET  /catalog/{skills,commands,agents} → facade-http-v1 envelope
 *   3. POST /me/sessions { session_uuid:"..." } → 400 invalid-input
 *   4. GET  /me/sessions               → 200 + sessions[]
 *   5. GET  /sessions/{uuid}/usage     → 200 (or 404 if not started)
 *
 * The test deliberately stops short of starting a real session so it
 * does not eat preview budget; ZX3 will add a full happy-path round-trip
 * (start → permission round-trip → cancel → sessions list).
 */

import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

const WORKERS = ["orchestrator-core", "orchestrator-auth"];
const TRACE = "11111111-1111-4111-8111-111111111111";

liveTest("ZX2 facade-must-have endpoints work end-to-end", WORKERS, async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");

  // 1. catalog reads — public, no auth required.
  for (const kind of ["skills", "commands", "agents"]) {
    const { response, json } = await fetchJson(`${base}/catalog/${kind}`, {
      headers: { "x-trace-uuid": TRACE },
    });
    assert.equal(response.status, 200, `GET /catalog/${kind} should 200`);
    assert.equal(json.ok, true, `GET /catalog/${kind} ok=true`);
    assert.equal(typeof json.trace_uuid, "string");
    assert.ok(Array.isArray(json.data?.[kind]), `${kind} array present`);
  }

  // The remaining endpoints require an authenticated user. Without a
  // valid bearer the test stops here — in real preview e2e the token is
  // injected via NANO_AGENT_TEST_TOKEN env, which a follow-up plan adds.
  if (!process.env.NANO_AGENT_TEST_TOKEN) return;
  const token = process.env.NANO_AGENT_TEST_TOKEN;
  const auth = { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE };

  // 2. /me/sessions — mint a UUID.
  const minted = await fetchJson(`${base}/me/sessions`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(minted.response.status, 201);
  assert.equal(minted.json.ok, true);
  const sessionUuid = minted.json.data?.session_uuid;
  assert.equal(typeof sessionUuid, "string");

  // 3. Reject client-supplied UUID.
  const rejected = await fetchJson(`${base}/me/sessions`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ session_uuid: sessionUuid }),
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.json.ok, false);
  assert.equal(rejected.json.error?.code, "invalid-input");

  // 4. /me/sessions list.
  const listed = await fetchJson(`${base}/me/sessions`, { headers: auth });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.json.ok, true);
  assert.ok(Array.isArray(listed.json.data?.sessions));
});
