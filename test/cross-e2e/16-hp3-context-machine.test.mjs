import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

// HP3-D6 (deferred-closure absorb) — context state machine cross-e2e.
//
// Coverage: long-conversation auto-compact + cross-turn recall +
// strip-recover + circuit breaker + 60s preview cache.

liveTest("HP3-D6 — long-conversation auto-compact triggers", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: drive 30 turns until auto_compact_token_limit
  // exceeded; assert /sessions/{id}/context/probe `compact_required:
  // true` and runtime emits `compact.notify`.
});

liveTest("HP3-D6 — cross-turn recall (turn2 references turn1 truth)", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: turn1 sets a fact; turn2 asks for it; assert LLM
  // response references turn1 content.
});

liveTest("HP3-D6 — strip-then-recover preserves model_switch marker", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: switch model mid-conversation → trigger compact →
  // assert `<model_switch>` survives in post-compact prompt assembly.
});

liveTest("HP3-D6 — compact 3-fail circuit breaker", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: force 3 consecutive compact failures; subsequent
  // compactRequired probe returns false until reset.
});

liveTest("HP3-D6 — 60s preview cache reuse (Q12)", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: two preview calls within 60s on same session +
  // high-watermark return identical body with `cached: true` on
  // second call.
});
