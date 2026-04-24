import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";
import { signOrchestratorJwt } from "../../shared/orchestrator-jwt.mjs";

const JWT_SECRET = process.env.NANO_AGENT_ORCHESTRATOR_JWT_SECRET;

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

liveTest("orchestrator-core reconnect succeeds for detached sessions", ["orchestrator-core"], async ({ getUrl }) => {
  assert.ok(JWT_SECRET, "set NANO_AGENT_ORCHESTRATOR_JWT_SECRET for orchestrator live tests");
  const base = getUrl("orchestrator-core");
  const wsBase = base.replace(/^http/, "ws");
  const sessionId = randomSessionId();
  const token = await signOrchestratorJwt({ sub: randomSessionId(), realm: "package-e2e" }, JWT_SECRET);

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ initial_input: "reconnect-test" }),
  });
  assert.equal(start.response.status, 200);

  const ws1 = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}`);
  await waitForOpen(ws1);
  ws1.close();

  const ws2 = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}`);
  await waitForOpen(ws2);
  ws2.close();
});

liveTest("orchestrator-core reconnect rejects terminal and missing sessions with typed taxonomy", ["orchestrator-core"], async ({ getUrl }) => {
  assert.ok(JWT_SECRET, "set NANO_AGENT_ORCHESTRATOR_JWT_SECRET for orchestrator live tests");
  const base = getUrl("orchestrator-core");
  const token = await signOrchestratorJwt({ sub: randomSessionId(), realm: "package-e2e" }, JWT_SECRET);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const terminalSessionId = randomSessionId();
  const start = await fetchJson(`${base}/sessions/${terminalSessionId}/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ initial_input: "reconnect-terminal-test" }),
  });
  assert.equal(start.response.status, 200);

  const cancel = await fetchJson(`${base}/sessions/${terminalSessionId}/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason: "terminal-taxonomy" }),
  });
  assert.equal(cancel.response.status, 200);
  assert.equal(cancel.json?.terminal, "cancelled");

  const reconnectTerminal = await fetchJson(`${base}/sessions/${terminalSessionId}/ws`, {
    headers: {
      authorization: `Bearer ${token}`,
      upgrade: "websocket",
    },
  });
  assert.equal(reconnectTerminal.response.status, 409);
  assert.equal(reconnectTerminal.json?.error, "session_terminal");
  assert.equal(reconnectTerminal.json?.terminal, "cancelled");

  const missingSessionId = randomSessionId();
  const reconnectMissing = await fetchJson(`${base}/sessions/${missingSessionId}/ws`, {
    headers: {
      authorization: `Bearer ${token}`,
      upgrade: "websocket",
    },
  });
  assert.equal(reconnectMissing.response.status, 404);
  assert.equal(reconnectMissing.json?.error, "session_missing");
});
