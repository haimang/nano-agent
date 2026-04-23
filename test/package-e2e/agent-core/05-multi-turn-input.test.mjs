import assert from "node:assert/strict";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";

/**
 * Package e2e — agent-core multi-turn via HTTP fallback /input.
 *
 * Per R2 wire truth:
 *   - session.start.body.initial_input  — first turn text
 *   - session.followup_input.body.text  — subsequent turn text
 *   - HTTP fallback route /input is the server-side mapping to
 *     session.followup_input (see http-controller.ts handleInput)
 *
 * This test locks:
 *   (a) /input requires `text` field; missing → HTTP 400 + canonical
 *       shape `{error: "input requires text"}`
 *   (b) /input with text returns 200 + `{ok:true, action:"input",
 *       phase:"attached"}`
 *   (c) multiple back-to-back /input calls don't crash the session;
 *       /status stays reachable after 2 follow-ups
 *   (d) timeline stays queryable after multi-turn
 */

liveTest(
  "agent-core multi-turn — /input requires text field",
  ["agent-core"],
  async ({ getUrl }) => {
    const base = getUrl("agent-core");
    const sessionId = randomSessionId();

    await fetchJson(`${base}/sessions/${sessionId}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initial_input: "t1" }),
    });

    const badInput = await fetchJson(`${base}/sessions/${sessionId}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(badInput.response.status, 400);
    assert.equal(badInput.json?.error, "input requires text");
  },
);

liveTest(
  "agent-core multi-turn — two follow-ups through /input stay stable",
  ["agent-core"],
  async ({ getUrl }) => {
    const base = getUrl("agent-core");
    const sessionId = randomSessionId();

    const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initial_input: "turn-1" }),
    });
    assert.equal(start.response.status, 200);

    // Two follow-ups back to back
    const t2 = await fetchJson(`${base}/sessions/${sessionId}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "turn-2" }),
    });
    assert.equal(t2.response.status, 200);
    assert.equal(t2.json?.ok, true);
    assert.equal(t2.json?.action, "input");

    const t3 = await fetchJson(`${base}/sessions/${sessionId}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "turn-3" }),
    });
    assert.equal(t3.response.status, 200);
    assert.equal(t3.json?.ok, true);
    assert.equal(t3.json?.action, "input");

    // After multi-turn, status and timeline still reachable
    const status = await fetchJson(`${base}/sessions/${sessionId}/status`);
    assert.equal(status.response.status, 200);
    assert.equal(status.json?.ok, true);

    const timeline = await fetchJson(`${base}/sessions/${sessionId}/timeline`);
    assert.equal(timeline.response.status, 200);
    assert.equal(timeline.json?.ok, true);
    assert.ok(Array.isArray(timeline.json?.events));
  },
);
