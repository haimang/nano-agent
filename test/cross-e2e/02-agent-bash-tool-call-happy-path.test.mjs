import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";

liveTest("agent-core verifies a real bash-core happy-path tool call", ["agent-core", "bash-core"], async ({ getUrl }) => {
  const sessionId = randomSessionId();
  const verify = await fetchJson(`${getUrl("agent-core")}/sessions/${sessionId}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
