import assert from "node:assert/strict";
import { expectProbe, fetchJson, liveTest } from "../../shared/live.mjs";

liveTest("filesystem-core preview probe reports library-worker truth", ["filesystem-core"], async ({ getUrl }) => {
  const { response, json } = await fetchJson(`${getUrl("filesystem-core")}/`);
  assert.equal(response.status, 200);
  expectProbe(json, {
    worker: "filesystem-core",
    status: "ok",
    phase: "worker-matrix-P4-absorbed",
    absorbed_runtime: true,
    library_worker: true,
  });
});
