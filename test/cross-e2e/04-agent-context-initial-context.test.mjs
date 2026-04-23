import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";

liveTest("agent-core live path consumes initial_context", ["agent-core"], async ({ getUrl }) => {
  const base = getUrl("agent-core");
  const sessionId = randomSessionId();

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      initial_input: "cross-e2e initial context",
      initial_context: {
        intent: { route: "cross-e2e", realm: "preview", confidence: 0.8 },
      },
    }),
  });
  assert.equal(start.response.status, 200);

  const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ check: "initial-context" }),
  });
  assert.equal(verify.response.status, 200);
  assert.equal(verify.json?.check, "initial-context");
  assert.ok(verify.json?.pendingCount >= 1);
  assert.ok(Array.isArray(verify.json?.assembledKinds));
  assert.ok(verify.json.assembledKinds.includes("session"));
  assert.ok(verify.json?.totalTokens > 0);
});
