import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

liveTest("orchestrator-core verifies a real bash-core happy-path tool call", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const { jsonHeaders } = await createOrchestratorAuth("cross-e2e");

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initial_input: "cross-capability-happy" }),
  });
  assert.equal(start.response.status, 200);

  const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      check: "capability-call",
      toolName: "pwd",
      toolInput: {},
    }),
  });
  assert.equal(verify.response.status, 200);
  assert.equal(verify.json?.ok, true);
  assert.equal(verify.json?.check, "capability-call");
  assert.equal(verify.json?.response?.status, "ok");
  assert.equal(typeof verify.json?.response?.output, "string");
});
