import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";
import { createOrchestratorAuth } from "../../shared/orchestrator-auth.mjs";

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

liveTest("orchestrator-core reconnect succeeds for detached sessions", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const wsBase = base.replace(/^http/, "ws");
  const sessionId = randomSessionId();
  const { token, traceUuid, jsonHeaders } = await createOrchestratorAuth("package-e2e");

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initial_input: "reconnect-test" }),
  });
  assert.equal(start.response.status, 200);

  const ws1 = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}&trace_uuid=${traceUuid}`);
  await waitForOpen(ws1);
  ws1.close();

  const ws2 = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}&trace_uuid=${traceUuid}`);
  await waitForOpen(ws2);
  ws2.close();
});

liveTest("orchestrator-core reconnect rejects terminal and missing sessions with typed taxonomy", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const { jsonHeaders, authHeaders } = await createOrchestratorAuth("package-e2e");

  const terminalSessionId = randomSessionId();
  const start = await fetchJson(`${base}/sessions/${terminalSessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initial_input: "reconnect-terminal-test" }),
  });
  assert.equal(start.response.status, 200);

  const cancel = await fetchJson(`${base}/sessions/${terminalSessionId}/cancel`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ reason: "terminal-taxonomy" }),
  });
  assert.equal(cancel.response.status, 200);
  assert.equal(cancel.json?.terminal, "cancelled");

  const reconnectTerminal = await fetchJson(`${base}/sessions/${terminalSessionId}/ws`, {
    headers: authHeaders,
  });
  assert.equal(reconnectTerminal.response.status, 409);
  assert.equal(reconnectTerminal.json?.error, "session_terminal");
  assert.equal(reconnectTerminal.json?.terminal, "cancelled");

  const missingSessionId = randomSessionId();
  const reconnectMissing = await fetchJson(`${base}/sessions/${missingSessionId}/ws`, {
    headers: authHeaders,
  });
  assert.equal(reconnectMissing.response.status, 404);
  assert.equal(reconnectMissing.json?.error, "session_missing");
});
