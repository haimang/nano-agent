import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

// ZX3 P4-04 / R30 fix(2026-04-27): ZX2 P1-02 set 5 leaf workers'
// `workers_dev: false`. Only orchestrator-core has a public workers.dev URL.
// Pre-ZX3 this test probed all 6 workers' `/` directly — that fails on real
// deploy. Post-ZX3: only probe orchestrator-core's facade `/`, which
// exposes `nacp_core_version` / `nacp_session_version` / `worker_version`
// / `public_facade` / `agent_binding` — proving the facade aggregates
// downstream workers via service binding without needing them publicly
// reachable.

liveTest("orchestrator-core public facade reports coherent stack metadata", ["orchestrator-core"], async ({ getUrl }) => {
  const { response, json } = await fetchJson(`${getUrl("orchestrator-core")}/`);
  assert.equal(response.status, 200);

  // facade probe contract surface
  assert.equal(json?.worker, "orchestrator-core");
  assert.equal(typeof json?.worker_version, "string");
  assert.equal(typeof json?.nacp_core_version, "string");
  assert.equal(typeof json?.nacp_session_version, "string");
  assert.equal(json?.status, "ok");
  assert.equal(json?.public_facade, true);
  assert.equal(json?.agent_binding, true);
});
