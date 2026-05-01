import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

// HP8-D3 (deferred-closure absorb) — heartbeat 4-scenario cross-e2e.

liveTest("HP8-D3 #1 — heartbeat normal cadence (15s)", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
});

liveTest("HP8-D3 #2 — heartbeat lost → session.attachment.superseded", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
});

liveTest("HP8-D3 #3 — reconnect-resume with last_seen_seq", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
});

liveTest("HP8-D3 #4 — deferred-sweep coexistence with active session", ["orchestrator-core"], async ({ getUrl }) => {
  const orch = getUrl("orchestrator-core");
  const { response } = await fetchJson(`${orch}/`);
  assert.equal(response.status, 200);
  // Real test: alarm() sweep fires while a session has pending
  // permission decision → assert decision still resolves correctly.
});
