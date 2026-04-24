import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";

const HTTP_CASES = [
  { action: "start", method: "POST", body: { initial_input: "legacy-start" } },
  { action: "input", method: "POST", body: { text: "legacy-input" } },
  { action: "cancel", method: "POST", body: {} },
  { action: "end", method: "POST", body: {} },
  { action: "status", method: "GET" },
  { action: "timeline", method: "GET" },
  { action: "verify", method: "POST", body: { check: "capability-call" } },
];

for (const { action, method, body } of HTTP_CASES) {
  liveTest(`agent-core legacy ${action} route returns canonical 410 retirement envelope`, ["agent-core"], async ({ getUrl }) => {
    const sessionId = randomSessionId();
    const res = await fetchJson(`${getUrl("agent-core")}/sessions/${sessionId}/${action}`, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    assert.equal(res.response.status, 410);
    assert.equal(res.json?.error, "legacy-session-route-retired");
    assert.equal(res.json?.canonical_worker, "orchestrator-core");
    assert.equal(typeof res.json?.message, "string");
    assert.match(res.json.message, /orchestrator-core/);
    assert.equal(typeof res.json?.canonical_url, "string");
    assert.match(res.json.canonical_url, /orchestrator-core/);
    assert.match(res.json.canonical_url, new RegExp(`/sessions/${sessionId}/${action}$`));
  });
}

liveTest("agent-core legacy ws route returns canonical 426 retirement envelope", ["agent-core"], async ({ getUrl }) => {
  const sessionId = randomSessionId();
  const res = await fetchJson(`${getUrl("agent-core")}/sessions/${sessionId}/ws`);

  assert.equal(res.response.status, 426);
  assert.equal(res.json?.error, "legacy-websocket-route-retired");
  assert.equal(res.json?.canonical_worker, "orchestrator-core");
  assert.equal(typeof res.json?.message, "string");
  assert.match(res.json.message, /orchestrator-core/);
  assert.equal(typeof res.json?.canonical_url, "string");
  assert.match(res.json.canonical_url, /orchestrator-core/);
  assert.match(res.json.canonical_url, new RegExp(`/sessions/${sessionId}/ws$`));
});
