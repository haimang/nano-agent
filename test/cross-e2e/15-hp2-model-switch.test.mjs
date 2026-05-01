import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

// HP2-D3 (deferred-closure absorb) — surviving model-surface cross-e2e.
//
// HPX1 retired the pure placeholder subcases from this file and kept only
// the live assertions that already have stable public oracles:
//   - alias resolution truth
//   - fallback metadata truth
//
// Live-only: skipped when NANO_AGENT_LIVE_E2E !== "1".

liveTest("HP2-D3 — model alias resolve", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { authHeaders } = await createOrchestratorAuth("cross-e2e");
  const detail = await fetchJson(`${orch}/models/%40alias%2Fbalanced`, {
    headers: authHeaders,
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json?.data?.requested_model_id, "@alias/balanced");
  assert.equal(detail.json?.data?.resolved_model_id, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(detail.json?.data?.resolved_from_alias, true);
  assert.deepEqual(detail.json?.data?.model?.aliases, ["@alias/balanced"]);
});

liveTest("HP2-D3 — model fallback metadata remains schema-live", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { authHeaders } = await createOrchestratorAuth("cross-e2e");
  const detail = await fetchJson(`${orch}/models/%40alias%2Freasoning`, {
    headers: authHeaders,
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json?.data?.resolved_model_id, "@cf/meta/llama-4-scout-17b-16e-instruct");
  assert.equal(
    Object.prototype.hasOwnProperty.call(detail.json?.data?.model ?? {}, "fallback_model_id"),
    true,
  );
  assert.equal(Array.isArray(detail.json?.data?.model?.supported_reasoning_levels), true);
});
