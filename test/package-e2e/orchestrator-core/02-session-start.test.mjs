import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";
import { createOrchestratorAuth } from "../../shared/orchestrator-auth.mjs";

liveTest("orchestrator-core public start relays first event", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const { jsonHeaders } = await createOrchestratorAuth("package-e2e");

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ initial_input: "orchestrator-package-start", initial_context: { route: "package-e2e", confidence: 1 } }),
  });

  assert.equal(start.response.status, 200);
  assert.equal(start.json?.ok, true);
  assert.equal(start.json?.action, "start");
  assert.equal(start.json?.session_uuid, sessionId);
  assert.equal(typeof start.json?.relay_cursor, "number");
  assert.ok(start.json?.first_event);
  assert.ok(["turn.begin", "session.update"].includes(start.json.first_event.kind));
});

liveTest("orchestrator-core verify exposes initial_context effect", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const { jsonHeaders, authHeaders } = await createOrchestratorAuth("package-e2e");

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      initial_input: "orchestrator-package-initial-context",
      initial_context: {
        intent: { route: "package-e2e", confidence: 0.9 },
        user_memory: { pinned_tone: "neutral" },
      },
    }),
  });
  assert.equal(start.response.status, 200);

  const layers = await fetchJson(`${base}/sessions/${sessionId}/context/layers`, {
    headers: authHeaders,
  });
  assert.equal(layers.response.status, 200);
  assert.equal(layers.json?.ok, true);
  const sessionLayer = layers.json?.data?.layers?.find((layer) => layer.kind === "session");
  assert.ok(sessionLayer);
  assert.equal(sessionLayer.required, true);
  assert.equal(typeof sessionLayer.preview, "string");
  assert.match(sessionLayer.preview, /package-e2e/);
  assert.match(sessionLayer.preview, /neutral/);
});
