import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

liveTest("orchestrator-core live path consumes initial_context", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const { jsonHeaders, authHeaders } = await createOrchestratorAuth("cross-e2e");

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      initial_input: "cross-e2e initial context",
      initial_context: {
        intent: { route: "cross-e2e", realm: "preview", confidence: 0.8 },
      },
    }),
  });
  assert.equal(start.response.status, 200);

  const layers = await fetchJson(`${base}/sessions/${sessionId}/context/layers`, {
    headers: authHeaders,
  });
  assert.equal(layers.response.status, 200);
  const sessionLayer = layers.json?.data?.layers?.find((layer) => layer.kind === "session");
  assert.ok(sessionLayer);
  assert.equal(sessionLayer.required, true);
  assert.equal(typeof sessionLayer.preview, "string");
  assert.match(sessionLayer.preview, /cross-e2e/);
  assert.match(sessionLayer.preview, /preview/);
});
