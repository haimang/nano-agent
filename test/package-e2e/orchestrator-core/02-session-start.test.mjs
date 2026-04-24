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
  const { jsonHeaders } = await createOrchestratorAuth("package-e2e");

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

  const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ check: "initial-context" }),
  });
  assert.equal(verify.response.status, 200);
  assert.equal(verify.json?.ok, true);
  assert.equal(verify.json?.action, "verify");
  assert.equal(verify.json?.check, "initial-context");
  assert.ok(verify.json?.pendingCount >= 1);
  assert.ok(Array.isArray(verify.json?.assembledKinds));
  assert.ok(verify.json.assembledKinds.includes("session"));
  assert.ok(verify.json?.totalTokens > 0);
});
