import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";

liveTest("agent-core preview keeps filesystem posture host-local", ["agent-core"], async ({ getUrl }) => {
  const verify = await fetchJson(`${getUrl("agent-core")}/sessions/${randomSessionId()}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ check: "filesystem-posture" }),
  });
  assert.equal(verify.response.status, 200);
  assert.equal(verify.json?.check, "filesystem-posture");
  assert.equal(verify.json?.hostLocalFilesystem, true);
  assert.equal(verify.json?.filesystemBindingActive, false);
  assert.equal(verify.json?.capabilityBindingActive, true);
});
