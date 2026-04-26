import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../../shared/live.mjs";

liveTest("orchestrator-core exposes aggregated worker health", ["orchestrator-core"], async ({ getUrl }) => {
  const { response, json } = await fetchJson(`${getUrl("orchestrator-core")}/debug/workers/health`);
  assert.equal(response.status, 200);
  assert.equal(json?.ok, true);
  assert.equal(json?.summary?.total, 6);
  assert.equal(json?.summary?.live, 6);
  assert.ok(Array.isArray(json?.workers));
  assert.deepEqual(
    json.workers.map((entry) => entry.worker),
    [
      "orchestrator-core",
      "orchestrator-auth",
      "agent-core",
      "bash-core",
      "context-core",
      "filesystem-core",
    ],
  );
  for (const entry of json.workers) {
    assert.equal(typeof entry.worker_version, "string");
    assert.equal(entry.live, true);
  }
});
