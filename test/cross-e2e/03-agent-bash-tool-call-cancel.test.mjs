import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

liveTest("orchestrator-core verifies a real bash-core cancel path", ["orchestrator-core", "bash-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const { jsonHeaders } = await createOrchestratorAuth("cross-e2e");

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initial_input: "cross-capability-cancel" }),
  });
  assert.equal(start.response.status, 200);

  const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      check: "capability-cancel",
      ms: 250,
      cancelAfterMs: 25,
    }),
  });
  assert.equal(verify.response.status, 200);
  assert.equal(verify.json?.check, "capability-cancel");
  assert.equal(verify.json?.cancelRequested, true);
  assert.equal(typeof verify.json?.cancelHonored, "boolean");
  assert.ok(["ok", "error"].includes(verify.json?.response?.status));
  if (verify.json?.cancelHonored) {
    assert.equal(verify.json?.response?.status, "error");
    assert.equal(verify.json?.response?.error?.code, "cancelled");
  }
});
