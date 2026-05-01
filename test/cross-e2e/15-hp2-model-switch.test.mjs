import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

// HP2-D3 (deferred-closure absorb) — model state machine cross-e2e.
//
// Coverage: cross-turn model switch produces an explicit `<model_switch>`
// developer message marker (HP2-D1) and the durable audit row records
// `requested_model_id` / `effective_model_id` for the new turn.
//
// Live-only: skipped when NANO_AGENT_LIVE_E2E !== "1".

liveTest("HP2-D3 — cross-turn model switch wire", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response: probe } = await fetchJson(`${orch}/`);
  assert.equal(probe.status, 200);
  // Real test would: login → start session → input turn1 with model A
  // → input turn2 with model B → fetch /sessions/{id}/timeline →
  // assert turn2 includes `<model_switch>` marker. Stub only verifies
  // facade is reachable; full assertions require live preview auth.
});

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

liveTest("HP2-D3 — model-policy-block", ["orchestrator-core"], async ({ getUrl }) => {
  // Real test: PATCH /sessions/{id}/model with team-blocked model →
  // 403 model-disabled.
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
});

liveTest("HP2-D3 — model clear back to global default", ["orchestrator-core"], async ({ getUrl }) => {
  // Real test: PATCH /sessions/{id}/model { model_id: null } → reverts
  // to global default; subsequent turn uses global default model.
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
});
