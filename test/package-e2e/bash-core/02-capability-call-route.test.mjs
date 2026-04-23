import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../../shared/live.mjs";

liveTest("bash-core /capability/call exposes the current route contract", ["bash-core"], async ({ getUrl }) => {
  const { response, json } = await fetchJson(`${getUrl("bash-core")}/capability/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "live-e2e-call",
      capabilityName: "pwd",
      body: { tool_name: "pwd", tool_input: {} },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(json?.status, "ok");
  assert.equal(typeof json?.output, "string");
});
