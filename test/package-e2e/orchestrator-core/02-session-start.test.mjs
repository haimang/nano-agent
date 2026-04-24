import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";
import { signOrchestratorJwt } from "../../shared/orchestrator-jwt.mjs";

const JWT_SECRET = process.env.NANO_AGENT_ORCHESTRATOR_JWT_SECRET;

liveTest("orchestrator-core public start relays first event", ["orchestrator-core"], async ({ getUrl }) => {
  assert.ok(JWT_SECRET, "set NANO_AGENT_ORCHESTRATOR_JWT_SECRET for orchestrator live tests");
  const base = getUrl("orchestrator-core");
  const sessionId = randomSessionId();
  const token = await signOrchestratorJwt({ sub: randomSessionId(), realm: "package-e2e" }, JWT_SECRET);

  const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
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
