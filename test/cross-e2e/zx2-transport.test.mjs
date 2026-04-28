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

// ZX3 P4-04 / R30(2026-04-27): orchestrator-auth `workers_dev:false` —
// only orchestrator-core has public URL; auth reached via service binding.
const WORKERS = ["orchestrator-core"];
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

  // ZX4 P3-05 + P3-07 — read-model 5-state view + ingress guard. The
  // freshly minted UUID must show up in the list as 'pending', and any
  // follow-up endpoint must reject pending session with the new error.
  const mintedRow = listed.json.data?.sessions?.find(
    (row) => row.session_uuid === sessionUuid,
  );
  assert.ok(mintedRow, "minted session must appear in /me/sessions list");
  assert.equal(mintedRow.status, "pending", "minted session must be pending");

  const followupReject = await fetchJson(
    `${base}/sessions/${sessionUuid}/input`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ text: "follow-up before start" }),
    },
  );
  assert.equal(followupReject.response.status, 409);
  assert.equal(followupReject.json.error?.code, "session-pending-only-start-allowed");

  // ZX4 P4-01 — permission decision contract: orchestrator accepts the
  // decision and returns 200 even when no agent runtime is awaiting it
  // (KV fallback path). This proves the decision pipeline is wired.
  const requestUuid = "99999999-9999-4999-8999-999999999999";
  const permission = await fetchJson(
    `${base}/sessions/${sessionUuid}/permission/decision`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        request_uuid: requestUuid,
        decision: "allow",
        scope: "once",
      }),
    },
  );
  assert.equal(permission.response.status, 200);
  assert.equal(permission.json.ok, true);
  assert.equal(permission.json.data?.request_uuid, requestUuid);

  // ZX4 P6-01 — elicitation answer contract: parallel pipeline.
  const answerUuid = "88888888-8888-4888-8888-888888888888";
  const elicit = await fetchJson(
    `${base}/sessions/${sessionUuid}/elicitation/answer`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        request_uuid: answerUuid,
        answer: "forty-two",
      }),
    },
  );
  assert.equal(elicit.response.status, 200);
  assert.equal(elicit.json.data?.request_uuid, answerUuid);
});
