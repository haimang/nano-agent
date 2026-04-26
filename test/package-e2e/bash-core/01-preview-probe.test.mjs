import assert from "node:assert/strict";
import { expectProbe, fetchJson, liveTest } from "../../shared/live.mjs";

liveTest("bash-core preview probe reports absorbed runtime", ["bash-core"], async ({ getUrl }) => {
  const { response, json } = await fetchJson(`${getUrl("bash-core")}/`);
  assert.equal(response.status, 200);
  expectProbe(json, {
    worker: "bash-core",
    status: "ok",
    phase: "worker-matrix-P1.B-absorbed",
    absorbed_runtime: true,
  });
  assert.equal(typeof json.worker_version, "string");
});
