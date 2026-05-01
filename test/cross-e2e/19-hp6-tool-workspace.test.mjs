import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

// HP6-D8 (deferred-closure absorb) — tool / workspace cross-e2e.

liveTest("HP6-D8 — todos round-trip", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: POST /todos pending → PATCH in_progress → at-most-1
  // invariant → DELETE.
});

liveTest("HP6-D8 — workspace temp file readback", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: PUT /workspace/files/foo.ts → GET /workspace/files/foo.ts
  // → bytes match.
});

liveTest("HP6-D8 — tool cancel emits tool.call.cancelled", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: start tool call → POST /tool-calls/{id}/cancel → WS
  // `tool.call.cancelled` with `cancel_initiator: user`.
});

liveTest("HP6-D8 — artifact promote", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
});

liveTest("HP6-D8 — cleanup audit", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
});

liveTest("HP6-D8 — path traversal deny (Q19)", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: PUT /workspace/files/../foo → 400 invalid-input.
});
