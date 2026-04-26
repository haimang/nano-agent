import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

const WORKERS = [
  "agent-core",
  "orchestrator-auth",
  "orchestrator-core",
  "bash-core",
  "context-core",
  "filesystem-core",
];

liveTest("6-worker preview inventory stays coherent", WORKERS, async ({ getUrl }) => {
  const probes = await Promise.all(
    WORKERS.map(async (worker) => {
      const { response, json } = await fetchJson(`${getUrl(worker)}/`);
      assert.equal(response.status, 200);
      return [worker, json];
    }),
  );

  const byWorker = Object.fromEntries(probes);
  assert.equal(byWorker["agent-core"]?.worker, "agent-core");
  assert.equal(byWorker["orchestrator-auth"]?.worker, "orchestrator-auth");
  assert.equal(byWorker["orchestrator-core"]?.worker, "orchestrator-core");
  assert.equal(byWorker["bash-core"]?.worker, "bash-core");
  assert.equal(byWorker["context-core"]?.worker, "context-core");
  assert.equal(byWorker["filesystem-core"]?.worker, "filesystem-core");

  for (const worker of WORKERS) {
    assert.equal(typeof byWorker[worker]?.worker_version, "string");
  }
});
