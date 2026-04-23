import assert from "node:assert/strict";
import { liveTest } from "../../shared/live.mjs";

liveTest("bash-core /capability/cancel exposes the current route contract", ["bash-core"], async ({ getUrl }) => {
  const base = getUrl("bash-core");
  const callPromise = fetch(`${base}/capability/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "live-e2e-cancel",
      capabilityName: "__px_sleep",
      body: { tool_name: "__px_sleep", tool_input: { ms: 150 } },
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const cancelResponse = await fetch(`${base}/capability/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "live-e2e-cancel",
      body: { reason: "cancelled by live test" },
    }),
  });
  const cancelBody = await cancelResponse.json();
  const callResponse = await callPromise;
  const callBody = await callResponse.json();

  assert.equal(cancelResponse.status, 200);
  assert.equal(cancelBody.ok, true);
  assert.equal(typeof cancelBody.cancelled, "boolean");
  assert.equal(callResponse.status, 200);
  assert.ok(["ok", "error"].includes(callBody.status));
  if (cancelBody.cancelled) {
    assert.equal(callBody.status, "error");
    assert.equal(callBody.error.code, "cancelled");
  }
});
