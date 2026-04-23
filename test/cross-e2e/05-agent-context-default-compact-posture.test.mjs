import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";

liveTest("agent-core preview keeps compact delegate opt-in by default", ["agent-core"], async ({ getUrl }) => {
  const verify = await fetchJson(`${getUrl("agent-core")}/sessions/${randomSessionId()}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ check: "compact-posture" }),
  });
  assert.equal(verify.response.status, 200);
  assert.equal(verify.json?.check, "compact-posture");
  assert.equal(verify.json?.compactDefaultMounted, false);
  assert.ok(
    verify.json?.kernelReason === null || typeof verify.json?.kernelReason === "string",
  );
});
