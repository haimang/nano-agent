import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";
import { createOrchestratorAuth } from "../../shared/orchestrator-auth.mjs";

const EXPECTED_SUPPORTED_CHECKS = [
  "capability-call",
  "capability-cancel",
  "initial-context",
  "compact-posture",
  "filesystem-posture",
];

liveTest("orchestrator-core routes input/status/timeline/verify/cancel through the façade", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const { authHeaders, jsonHeaders } = await createOrchestratorAuth("package-e2e");

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initial_input: "route-family-test" }),
  });
  assert.equal(start.response.status, 200);

  const badInput = await fetchJson(`${base}/sessions/${sessionId}/input`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(badInput.response.status, 400);
  assert.equal(badInput.json?.error?.code ?? badInput.json?.error, "invalid-input-body");
  assert.match(String(badInput.json?.error?.message ?? badInput.json?.message ?? ""), /requires .*text/i);

  const input = await fetchJson(`${base}/sessions/${sessionId}/input`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ text: "follow up" }),
  });
  assert.equal(input.response.status, 200);

  const secondInput = await fetchJson(`${base}/sessions/${sessionId}/input`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ text: "follow up 2" }),
  });
  assert.equal(secondInput.response.status, 200);

  const status = await fetchJson(`${base}/sessions/${sessionId}/status`, { headers: authHeaders });
  assert.equal(status.response.status, 200);
  assert.equal(status.json?.action, "status");

  const timeline = await fetchJson(`${base}/sessions/${sessionId}/timeline`, { headers: authHeaders });
  assert.equal(timeline.response.status, 200);
  assert.equal(timeline.json?.action, "timeline");
  assert.ok(Array.isArray(timeline.json?.events));

  const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ check: "bogus" }),
  });
  assert.equal(verify.response.status, 200);
  assert.equal(verify.json?.ok, true);
  assert.equal(verify.json?.action, "verify");
  assert.equal(verify.json?.check, "bogus");
  assert.equal(verify.json?.error, "unknown-verify-check");
  assert.ok(Array.isArray(verify.json?.supported));
  for (const name of EXPECTED_SUPPORTED_CHECKS) {
    assert.ok(
      verify.json.supported.includes(name),
      `expected supported list to include ${name}; got ${JSON.stringify(verify.json.supported)}`,
    );
  }

  const cancel = await fetchJson(`${base}/sessions/${sessionId}/cancel`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ reason: "package-e2e" }),
  });
  assert.equal(cancel.response.status, 200);
  assert.equal(cancel.json?.terminal, "cancelled");

  const endedStatus = await fetchJson(`${base}/sessions/${sessionId}/status`, { headers: authHeaders });
  assert.equal(endedStatus.response.status, 200);
  assert.equal(typeof endedStatus.json?.phase, "string");
});
