import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";

liveTest("agent-core HTTP fallback start/status/timeline stays reachable", ["agent-core"], async ({ getUrl }) => {
  const base = getUrl("agent-core");
  const sessionId = randomSessionId();

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initial_input: "live-e2e-smoke" }),
  });
  assert.equal(start.response.status, 200);
  assert.equal(start.json?.ok, true);
  assert.equal(start.json?.action, "start");

  const status = await fetchJson(`${base}/sessions/${sessionId}/status`);
  assert.equal(status.response.status, 200);
  assert.equal(status.json?.ok, true);
  assert.equal(status.json?.action, "status");
  assert.equal(typeof status.json?.phase, "string");

  const timeline = await fetchJson(`${base}/sessions/${sessionId}/timeline`);
  assert.equal(timeline.response.status, 200);
  assert.equal(timeline.json?.ok, true);
  assert.equal(timeline.json?.action, "timeline");
  assert.ok(Array.isArray(timeline.json?.events));
});
