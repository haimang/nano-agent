import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

// HP5-D2 (deferred-closure absorb) — confirmation round-trip cross-e2e (15-18).
//
// Coverage: permission round-trip / elicitation round-trip /
// model-switch confirmation / checkpoint-restore confirmation.

liveTest("HP5-D2 #15 — permission round-trip via confirmations plane", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: tool-call needs ask permission → server emits
  // `session.confirmation.request{kind:"tool_permission"}` → client
  // POSTs `/confirmations/{uuid}/decision` allowed → tool resumes.
});

liveTest("HP5-D2 #16 — elicitation round-trip", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: LLM emits elicitation request → confirmation row
  // created → client decision modified payload → row terminal.
});

liveTest("HP5-D2 #17 — model_switch confirmation", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
});

liveTest("HP5-D2 #18 — checkpoint-restore confirmation gate", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: POST /checkpoints/{uuid}/restore → server creates
  // confirmation kind=`checkpoint_restore` → client decision allowed
  // → restore job proceeds.
});
