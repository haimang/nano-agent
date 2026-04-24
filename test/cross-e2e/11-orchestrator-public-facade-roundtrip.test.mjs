import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../shared/live.mjs";
import { createOrchestratorAuth } from "../shared/orchestrator-auth.mjs";

// Assumption at orchestration-facade close: bash-core request execution now
// flows through CapabilityExecutor, but no additional beforeCapabilityExecute
// provider is configured yet. A future credit/quota charter may need to extend
// this test with funded / authorized fixture state.

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket open timeout")), 5_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error("websocket error"));
    }, { once: true });
  });
}

function waitForMatchingMessage(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket message timeout")), 5_000);
    ws.addEventListener("message", (event) => {
      let parsed;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!predicate(parsed)) return;
      clearTimeout(timer);
      resolve(parsed);
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error("websocket error"));
    }, { once: true });
  });
}

liveTest(
  "orchestrator-core final public facade roundtrip stays coherent across agent-core and bash-core",
  ["orchestrator-core", "agent-core", "bash-core"],
  async ({ getUrl }) => {
    const base = getUrl("orchestrator-core");
    const agentBase = getUrl("agent-core");
    const wsBase = base.replace(/^http/, "ws");
    const sessionId = randomSessionId();
    const { token, traceUuid, authHeaders, jsonHeaders } = await createOrchestratorAuth("cross-e2e");

    const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ initial_input: "final-roundtrip" }),
    });
    assert.equal(start.response.status, 200);

    const ws = new WebSocket(`${wsBase}/sessions/${sessionId}/ws?access_token=${token}&trace_uuid=${traceUuid}`);
    await waitForOpen(ws);
    const event = await waitForMatchingMessage(
      ws,
      (message) => message.kind === "event" && message.name === "session.stream.event",
    );
    assert.equal(event.name, "session.stream.event");

    const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        check: "capability-call",
        toolName: "pwd",
        toolInput: {},
      }),
    });
    assert.equal(verify.response.status, 200);
    assert.equal(verify.json?.response?.status, "ok");

    const cancel = await fetchJson(`${base}/sessions/${sessionId}/cancel`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(cancel.response.status, 200);
    assert.equal(cancel.json?.terminal, "cancelled");

    const status = await fetchJson(`${base}/sessions/${sessionId}/status`, { headers: authHeaders });
    assert.equal(status.response.status, 200);
    assert.equal(status.json?.ok, true);

    const timeline = await fetchJson(`${base}/sessions/${sessionId}/timeline`, { headers: authHeaders });
    assert.equal(timeline.response.status, 200);
    assert.ok(Array.isArray(timeline.json?.events));

    const legacy = await fetchJson(`${agentBase}/sessions/${sessionId}/status`);
    assert.equal(legacy.response.status, 410);
    assert.equal(legacy.json?.canonical_worker, "orchestrator-core");

    ws.close();
  },
);
