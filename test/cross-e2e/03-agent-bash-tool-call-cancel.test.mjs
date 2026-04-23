import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";

liveTest("agent-core verifies a real bash-core cancel path", ["agent-core", "bash-core"], async ({ getUrl }) => {
  const sessionId = randomSessionId();
  const verify = await fetchJson(`${getUrl("agent-core")}/sessions/${sessionId}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
