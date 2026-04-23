import assert from "node:assert/strict";
import { expectProbe, fetchJson, liveTest } from "../../shared/live.mjs";

liveTest("context-core preview probe reports library-worker truth", ["context-core"], async ({ getUrl }) => {
  const { response, json } = await fetchJson(`${getUrl("context-core")}/`);
  assert.equal(response.status, 200);
  expectProbe(json, {
    worker: "context-core",
    status: "ok",
    phase: "worker-matrix-P3-absorbed",
    absorbed_runtime: true,
    library_worker: true,
  });
});
