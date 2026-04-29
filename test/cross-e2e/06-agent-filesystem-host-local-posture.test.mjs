import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

liveTest("orchestrator-core preview keeps filesystem posture host-local with binding active", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const { jsonHeaders } = await createOrchestratorAuth("cross-e2e");

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initial_input: "cross-e2e filesystem posture" }),
  });
  assert.equal(start.response.status, 200);

  const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ check: "filesystem-posture" }),
  });
  assert.equal(verify.response.status, 200);
  assert.equal(verify.json?.check, "filesystem-posture");
  assert.equal(verify.json?.hostLocalFilesystem, true);
  assert.equal(verify.json?.filesystemBindingActive, true);
  assert.equal(verify.json?.capabilityBindingActive, true);
});
