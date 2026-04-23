import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";

/**
 * Package e2e — agent-core session lifecycle (start → cancel).
 *
 * Locks the HTTP fallback lifecycle transitions exposed by the
 * orchestrator:
 *   - POST /start  → phase="attached" (session wired)
 *   - POST /cancel → phase="attached" (session still alive; cancel
 *     only ends the in-flight turn, not the session)
 *   - POST /end    → HTTP 405 + canonical error "session.end is
 *     server-emitted; clients should send session.cancel"
 *     (asymmetry between client-initiated cancel vs server-emitted end)
 *   - POST /status after cancel stays reachable
 */

liveTest(
  "agent-core session lifecycle — start / cancel / status round-trip is stable",
  ["agent-core"],
  async ({ getUrl }) => {
    const base = getUrl("agent-core");
    const sessionId = randomSessionId();

    const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initial_input: "lifecycle-smoke" }),
    });
    assert.equal(start.response.status, 200);
    assert.equal(start.json?.ok, true);
    assert.equal(start.json?.action, "start");
    assert.equal(start.json?.phase, "attached");

    const cancel = await fetchJson(`${base}/sessions/${sessionId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(cancel.response.status, 200);
    assert.equal(cancel.json?.ok, true);
    assert.equal(cancel.json?.action, "cancel");
    assert.equal(cancel.json?.phase, "attached");

    const status = await fetchJson(`${base}/sessions/${sessionId}/status`);
    assert.equal(status.response.status, 200);
    assert.equal(status.json?.ok, true);
    assert.equal(status.json?.action, "status");
    assert.equal(typeof status.json?.phase, "string");
  },
);

liveTest(
  "agent-core /end rejects client-initiated end with canonical 405 envelope",
  ["agent-core"],
  async ({ getUrl }) => {
    const base = getUrl("agent-core");
    const sessionId = randomSessionId();

    // Start first so we have a DO instance for the /end probe to hit
    await fetchJson(`${base}/sessions/${sessionId}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initial_input: "end-asymmetry" }),
    });

    const end = await fetchJson(`${base}/sessions/${sessionId}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    // Server-emitted end asymmetry must be enforced at the HTTP layer
    assert.equal(end.response.status, 405);
    assert.ok(typeof end.json?.error === "string");
    assert.match(end.json.error, /server-emitted/);
  },
);
