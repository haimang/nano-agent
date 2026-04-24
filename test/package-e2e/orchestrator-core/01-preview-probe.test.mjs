import assert from "node:assert/strict";
import { expectProbe, fetchJson, liveTest } from "../../shared/live.mjs";

liveTest("orchestrator-core preview probe exposes closed façade marker", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const probe = await fetchJson(`${base}/health`);
  assert.equal(probe.response.status, 200);
  expectProbe(probe.json, {
    worker: "orchestrator-core",
    status: "ok",
    phase: "orchestration-facade-closed",
    public_facade: true,
  });
});
