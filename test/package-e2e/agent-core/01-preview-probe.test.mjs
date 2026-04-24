import assert from "node:assert/strict";
import { expectProbe, fetchJson, liveTest } from "../../shared/live.mjs";

liveTest("agent-core preview probe reports live-loop truth", ["agent-core"], async ({ getUrl }) => {
  const { response, json } = await fetchJson(`${getUrl("agent-core")}/`);
  assert.equal(response.status, 200);
  expectProbe(json, {
    worker: "agent-core",
    status: "ok",
    phase: "orchestration-facade-closed",
    absorbed_runtime: true,
    live_loop: true,
  });
  assert.equal(typeof json.capability_binding, "boolean");
});
